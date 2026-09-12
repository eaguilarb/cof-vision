# Build estático de la app (Expo web export) servido por nginx — no
# necesita Node corriendo en producción, solo archivos planos.
#
# EXPO_PUBLIC_API_URL debe ser la URL pública por la que los navegadores
# van a llegar al backend (ver DEPLOY.md) — queda incrustada en el
# JavaScript al momento del build, así que si cambias el dominio hay que
# reconstruir esta imagen.

FROM node:22-alpine AS build
ARG EXPO_PUBLIC_API_URL
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL} npx expo export --platform web

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
