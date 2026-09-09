import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { loadDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getAllCases, withLocalAge } from '../services/case-service.js';
import { CATEGORIA_LABELS, resolutionActionLabel } from '../intranet.js';
import { GLASS_CATEGORIA_LABELS, glassResolutionActionLabel } from '../glass.js';
import type { CaseStatus, CaseWithAge, DbShape } from '../types.js';

async function casesForModule(db: DbShape, module: string | undefined): Promise<CaseWithAge[]> {
  if (module === 'glass') return db.glassCases.map(withLocalAge);
  return getAllCases(db);
}

function categoriaLabel(module: string | undefined, categoria: string): string {
  if (module === 'glass') return GLASS_CATEGORIA_LABELS[categoria] ?? categoria;
  return CATEGORIA_LABELS[categoria] ?? categoria;
}

function actionLabel(module: string | undefined, categoria: string | null, action: string | null): string | null {
  if (module === 'glass') return glassResolutionActionLabel(action);
  return resolutionActionLabel(categoria, action);
}

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

const STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'Pendiente',
  assigned: 'Asignado',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
};

function applyFilters(
  cases: CaseWithAge[],
  query: { status?: string; technicianId?: string; mine?: string },
  auth?: { technicianId?: string },
): CaseWithAge[] {
  let result = cases;
  if (query.mine === 'true' && auth?.technicianId) {
    result = result.filter((c) => c.assignedTechnicianId === auth.technicianId);
  } else if (query.technicianId) {
    result = result.filter((c) => c.assignedTechnicianId === query.technicianId);
  }
  if (query.status) {
    result = result.filter((c) => c.status === query.status);
  }
  return result;
}

// GET /reports/summary?days=30 — agregados para el dashboard (por estado,
// por terminal, por técnico y repuestos/piezas usadas al cerrar casos).
// `days` limita a casos creados en esos últimos N días (omite para todos).
reportsRouter.get('/summary', async (req, res) => {
  try {
    const db = loadDb();
    const module = req.query.module as string | undefined;
    let cases = await casesForModule(db, module);

    const days = Number(req.query.days);
    if (Number.isFinite(days) && days > 0) {
      const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
      cases = cases.filter((c) => new Date(c.createdAt).getTime() >= sinceMs);
    }

    const byStatus: Record<CaseStatus, number> = { open: 0, assigned: 0, in_progress: 0, resolved: 0 };
    const terminals = new Map<
      string,
      { total: number; resolved: number; resolvedDaysSum: number; resolvedCount: number }
    >();
    const technicians = new Map<
      string,
      { assigned: number; resolved: number; resolvedDaysSum: number; resolvedCount: number }
    >();
    const parts = new Map<string, { label: string; count: number }>();

    for (const c of cases) {
      byStatus[c.status] += 1;

      const key = c.clientName || 'Sin terminal';
      const t = terminals.get(key) ?? { total: 0, resolved: 0, resolvedDaysSum: 0, resolvedCount: 0 };
      t.total += 1;
      if (c.status === 'resolved') {
        t.resolved += 1;
        if (c.resolvedInDays != null) {
          t.resolvedDaysSum += c.resolvedInDays;
          t.resolvedCount += 1;
        }
      }
      terminals.set(key, t);

      if (c.assignedTechnicianId) {
        const tech = technicians.get(c.assignedTechnicianId) ?? {
          assigned: 0,
          resolved: 0,
          resolvedDaysSum: 0,
          resolvedCount: 0,
        };
        tech.assigned += 1;
        if (c.status === 'resolved') {
          tech.resolved += 1;
          if (c.resolvedInDays != null) {
            tech.resolvedDaysSum += c.resolvedInDays;
            tech.resolvedCount += 1;
          }
        }
        technicians.set(c.assignedTechnicianId, tech);
      }

      if (c.status === 'resolved' && c.resolutionAction) {
        const groupKey = `${c.categoria ?? 'general'}::${c.resolutionAction}`;
        const label = c.categoria
          ? `${categoriaLabel(module, c.categoria)} — ${actionLabel(module, c.categoria, c.resolutionAction)}`
          : (actionLabel(module, null, c.resolutionAction) ?? c.resolutionAction);
        const p = parts.get(groupKey) ?? { label, count: 0 };
        p.count += 1;
        parts.set(groupKey, p);
      }
    }

    const byTerminal = Array.from(terminals.entries())
      .map(([terminal, t]) => ({
        terminal,
        total: t.total,
        resolved: t.resolved,
        resolvedPct: t.total > 0 ? Math.round((t.resolved / t.total) * 100) : 0,
        avgDaysToResolve: t.resolvedCount > 0 ? Math.round((t.resolvedDaysSum / t.resolvedCount) * 10) / 10 : null,
      }))
      .sort((a, b) => b.total - a.total);

    const byTechnician = Array.from(technicians.entries())
      .map(([technicianId, t]) => ({
        technicianId,
        name: db.technicians.find((tech) => tech.id === technicianId)?.name ?? 'Técnico desconocido',
        assigned: t.assigned,
        resolved: t.resolved,
        resolvedPct: t.assigned > 0 ? Math.round((t.resolved / t.assigned) * 100) : 0,
        avgDaysToResolve: t.resolvedCount > 0 ? Math.round((t.resolvedDaysSum / t.resolvedCount) * 10) / 10 : null,
      }))
      .sort((a, b) => b.assigned - a.assigned);

    const partsUsage = Array.from(parts.values()).sort((a, b) => b.count - a.count);

    res.json({
      generatedAt: new Date().toISOString(),
      totalCases: cases.length,
      byStatus,
      byTerminal,
      byTechnician,
      partsUsage,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error al generar el reporte' });
  }
});

// GET /reports/export?format=xlsx|pdf&status=&technicianId=&mine=
reportsRouter.get('/export', async (req, res) => {
  const format = String(req.query.format || 'xlsx');
  if (format !== 'xlsx' && format !== 'pdf') {
    res.status(400).json({ error: 'format debe ser xlsx o pdf' });
    return;
  }

  try {
    const db = loadDb();
    const module = req.query.module as string | undefined;
    let cases = await casesForModule(db, module);
    cases = applyFilters(cases, req.query as { status?: string; technicianId?: string; mine?: string }, req.auth);
    cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const technicianName = (id: string | null) =>
      id ? db.technicians.find((t) => t.id === id)?.name ?? id : 'Sin asignar';
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Casos');
      sheet.columns = [
        { header: 'Código', key: 'code', width: 12 },
        { header: 'Título', key: 'title', width: 32 },
        { header: 'Terminal', key: 'terminal', width: 18 },
        { header: 'Patente/Equipo', key: 'equipmentId', width: 14 },
        { header: 'Estado', key: 'status', width: 14 },
        { header: 'Prioridad', key: 'priority', width: 10 },
        { header: 'Técnico', key: 'technician', width: 20 },
        { header: 'Días abierto', key: 'daysOpen', width: 12 },
        { header: 'Días para resolver', key: 'resolvedInDays', width: 16 },
        { header: 'Acción de cierre', key: 'resolutionAction', width: 28 },
        { header: 'Creado', key: 'createdAt', width: 20 },
        { header: 'Actualizado', key: 'updatedAt', width: 20 },
        { header: 'Descripción', key: 'description', width: 42 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const c of cases) {
        sheet.addRow({
          code: c.code,
          title: c.title,
          terminal: c.clientName,
          equipmentId: c.equipmentId,
          status: STATUS_LABELS[c.status],
          priority: c.priority,
          technician: technicianName(c.assignedTechnicianId),
          daysOpen: c.status === 'resolved' ? '' : c.daysOpen,
          resolvedInDays: c.resolvedInDays ?? '',
          resolutionAction: actionLabel(module, c.categoria, c.resolutionAction) ?? '',
          createdAt: new Date(c.createdAt).toLocaleString('es-CL'),
          updatedAt: new Date(c.updatedAt).toLocaleString('es-CL'),
          description: c.description,
        });
      }
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="casos-cof-${stamp}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="casos-cof-${stamp}.pdf"`);
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').text('Casos COF');
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Generado: ${new Date().toLocaleString('es-CL')} · ${cases.length} casos`);
    doc.fillColor('#000').moveDown(0.5);

    const headers = ['Código', 'Terminal', 'Patente', 'Estado', 'Prioridad', 'Técnico', 'Días', 'Descripción'];
    const colWidths = [55, 95, 60, 65, 60, 90, 40, 300];

    function drawRow(values: string[], y: number, bold = false) {
      let x = doc.page.margins.left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      values.forEach((v, i) => {
        doc.text(v, x, y, { width: colWidths[i], ellipsis: true });
        x += colWidths[i];
      });
    }

    let y = doc.y;
    drawRow(headers, y, true);
    y += 16;

    for (const c of cases) {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(headers, y, true);
        y += 16;
      }
      drawRow(
        [
          c.code,
          c.clientName,
          c.equipmentId,
          STATUS_LABELS[c.status],
          c.priority,
          technicianName(c.assignedTechnicianId),
          c.status === 'resolved' ? `${c.resolvedInDays ?? '—'}` : `${c.daysOpen}`,
          c.description,
        ],
        y,
      );
      y += 16;
    }

    doc.end();
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error al generar la exportación' });
  }
});
