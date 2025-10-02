FROM node:18-slim

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./
COPY .npmrc ./

# Install dependencies without using cache and with clean install
RUN npm cache clean --force && \
    npm ci --omit=dev --no-cache

# Copy the rest of the application
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
