FROM node:18.13.0

# Create the application directory
WORKDIR /app

# Copy the dependency files
COPY package.json yarn.lock ./

# Application dependencies
RUN yarn install
