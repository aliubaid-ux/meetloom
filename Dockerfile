FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies strictly
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD [ "npm", "start" ]
