# Página de COF Vision con usuario y contraseña (Node 20, sin dependencias).
FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
