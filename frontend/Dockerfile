FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Bake the backend URL at build time using sed after build
# VITE_API_URL must be passed as build arg
ARG VITE_API_URL=https://fantasy-cricket-production.up.railway.app
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Only need express to serve static files — no proxy needed
RUN npm install express

COPY --from=builder /app/dist ./dist
COPY server.cjs ./

EXPOSE 3000

CMD ["node", "server.cjs"]
