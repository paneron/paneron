FROM node:16

# NOTE: This is almost identical to tsserver.Dockerfile,
# and they could probably be refactored to reuse a single common part.
# The files intentionally maintain 1:1 correspondence line by line,
# for ease of such refactoring.
#
# These comments should not be removed until such refactoring is done.
#
# IMPORTANT: Until then, any change you want to make to one Dockerfile
# has to be reproduced in the other.

# Stuff needed to get Electron to run
RUN apt-get update && apt-get install \
    git libx11-xcb1 libxcb-dri3-0 libxtst6 libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2 \
    libsecret-1-dev \
    gnome-keyring \
    libxshmfence1 libglu1 libgbm-dev \
    jq \
    -yq --no-install-suggests --no-install-recommends

RUN apt-get clean && rm -rf /var/lib/apt/lists/

RUN npm install -g pnpm

ARG project_path=/paneron

# Electron doesn’t like to be run as root
# We create a dedicated user and set its home to project_path
RUN useradd -d ${project_path:?} paneron

USER paneron
WORKDIR ${project_path:?}

COPY --chown=paneron:paneron package.json package.json
COPY --chown=paneron:paneron pnpm-lock.yaml pnpm-lock.yaml
# If you work on dependencies, like registry-kit or extension-kit
# COPY --chown=paneron:paneron dependencies-local dependencies-local
RUN pnpm install

RUN pnpm --package=@electron/rebuild dlx electron-rebuild -v $(jq -r .devDependencies.electron < package.json)
# RUN pnpm i -D typescript-language-server "typescript@4.2.2"

# see https://github.com/electron/electron/issues/17972
USER root
# RUN chown root ${project_path:?}/node_modules/electron/dist/chrome-sandbox
# RUN chmod 4755 ${project_path:?}/node_modules/electron/dist/chrome-sandbox

VOLUME ${project_path:?}/node_modules
VOLUME ${project_path:?}/.config

COPY --chown=paneron:paneron . .

# RUN apt-get update && apt-get install -yq --no-install-suggests --no-install-recommends x11-apps && apt-get clean && rm -rf /var/lib/apt/lists/

USER paneron
CMD  dbus-run-session -- sh -c "echo 'testpass' | gnome-keyring-daemon --unlock && pnpm run dev --no-sandbox"
