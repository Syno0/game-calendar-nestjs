# Base image
FROM node:22-alpine

# Polices pour le rendu des images de partage : l'image alpine n'en embarque
# aucune, et @napi-rs/canvas dessinerait alors des rectangles vides.
RUN apk add --no-cache font-noto

# Create app directory
WORKDIR /app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Bundle app source
COPY . .

# Generate the Prisma client (needs prisma/schema.prisma, so after COPY)
RUN npx prisma generate

# Creates a "dist" folder with the production build
RUN npm run build

# Start the server using the production build
CMD [ "npm", "run", "start:prod" ]