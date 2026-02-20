FROM node:20-slim

WORKDIR /app

# Copy package.json only (ignore lockfile to avoid platform issues)
COPY package.json ./

# Install dependencies
# Install build tools for native modules (python3, make, g++)
RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*

RUN npm install

# Copy source
COPY . .

# Expose the configured port
EXPOSE 5656

# Start development server
CMD ["npm", "run", "dev"]
