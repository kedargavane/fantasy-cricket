FROM node:20-alpine

# better-sqlite3 needs Python and build tools for native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./

# Install all deps (better-sqlite3 needs to compile)
RUN npm install

# Copy source code
COPY src ./src
COPY scripts ./scripts

# Create data directory for SQLite volume mount
RUN mkdir -p /data

EXPOSE 3001

CMD ["node", "src/server.js"]
