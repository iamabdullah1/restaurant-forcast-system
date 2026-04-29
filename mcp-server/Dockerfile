FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Start the MCP server using standard IO transport
CMD ["npm", "start"]
