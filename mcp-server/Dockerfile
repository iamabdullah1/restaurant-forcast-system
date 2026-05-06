FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Optional HTTP API (set PORT or MCP_HTTP_PORT at runtime)
EXPOSE 7860

# Start the MCP server using standard IO transport
CMD ["npm", "start"]
