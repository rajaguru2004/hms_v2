#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define variables
REGISTRY="ghcr.io"
USERNAME="rajaguru2004"
IMAGE_NAME="hms-v2-api"
IMAGE_URI="${REGISTRY}/${USERNAME}/${IMAGE_NAME}"

# Color codes for pretty printing
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🚀 Starting deployment process for ${IMAGE_NAME}...${NC}"

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Error: docker is not installed or not in PATH.${NC}"
    exit 1
fi

# Check if docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Error: Docker daemon is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Get version from package.json
if [ -f "package.json" ]; then
    VERSION=$(node -p "require('./package.json').version" 2>/dev/null)
    if [ -z "$VERSION" ]; then
        echo -e "${YELLOW}⚠️  Could not parse version from package.json using Node.js. Defaulting version to 1.0.0${NC}"
        VERSION="1.0.0"
    fi
else
    echo -e "${YELLOW}⚠️  package.json not found in current directory. Defaulting version to 1.0.0${NC}"
    VERSION="1.0.0"
fi

echo -e "${GREEN}📦 Version identified: ${VERSION}${NC}"

# Check registry authentication
# We inspect ~/.docker/config.json to check if there is a config for ghcr.io.
# If not, warn the user.
echo -e "${YELLOW}🔐 Checking GHCR authentication...${NC}"
if ! grep -q "${REGISTRY}" ~/.docker/config.json 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Could not verify GHCR login in ~/.docker/config.json.${NC}"
    echo -e "${YELLOW}Please ensure you are authenticated by running:${NC}"
    echo -e "   echo \$MY_GITHUB_TOKEN | docker login ${REGISTRY} -u ${USERNAME} --password-stdin"
    echo -e "${YELLOW}Press [Enter] to continue if you are already authenticated, or Ctrl+C to abort...${NC}"
    read -r
fi

# Build docker image
echo -e "${YELLOW}🏗️  Building production Docker image...${NC}"
docker build \
  --target production \
  -t "${IMAGE_URI}:latest" \
  -t "${IMAGE_URI}:${VERSION}" \
  .

echo -e "${GREEN}✅ Build completed successfully!${NC}"

# Push docker images
echo -e "${YELLOW}📤 Pushing image to GHCR (${IMAGE_URI}:latest & ${IMAGE_URI}:${VERSION})...${NC}"
docker push "${IMAGE_URI}:latest"
docker push "${IMAGE_URI}:${VERSION}"

echo -e "${GREEN}✨ Deployment complete! Image pushed to GHCR successfully.${NC}"
echo -e "${GREEN}👉 Image URI: ${IMAGE_URI}:latest${NC}"
