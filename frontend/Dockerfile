FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

ARG VITE_API_URL=https://fantasy-cricket-production.up.railway.app
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Copy built files and node_modules from builder (includes express)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY server.cjs ./

EXPOSE 3000

CMD ["node", "server.cjs"]
