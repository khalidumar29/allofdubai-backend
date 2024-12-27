# Use a lightweight Node.js image
FROM node:16-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files to install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Compile TypeScript to JavaScript
RUN npx tsc

# Expose the app port
EXPOSE 3000

# Command to start the app
CMD ["node", "index.js"]
