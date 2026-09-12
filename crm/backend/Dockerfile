# Imagen de producción del backend del CRM — corre en cualquier servidor
# con Docker instalado (empresa, casa, cualquier VPS), sin depender de
# Railway. Multi-stage: compila TypeScript en una etapa y deja en la
# imagen final solo lo necesario para correr.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Los datos (cuentas, casos de Vidrios, fotos) se guardan aquí — monta un
# volumen en este path para que sobrevivan a un `docker compose up`
# nuevo o una actualización de imagen.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 4000
CMD ["npm", "start"]
