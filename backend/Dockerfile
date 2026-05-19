FROM node:22.22.3-alpine3.23

WORKDIR /some_ai/backend

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
