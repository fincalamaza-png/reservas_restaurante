FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN chmod +x /app/start.sh
EXPOSE 3000
CMD ["/bin/sh", "/app/start.sh"]
