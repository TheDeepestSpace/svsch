# Build UHDM
FROM public.ecr.aws/lts/ubuntu:22.04_stable AS uhdm-builder
ARG DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y build-essential cmake ninja-build git python3 python3-pip
RUN pip3 install orderedmultidict
RUN git clone --recursive --branch v1.84 https://github.com/chipsalliance/UHDM.git /tmp/UHDM
RUN cd /tmp/UHDM && \
    mkdir build && cd build && \
    cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/uhdm && \
    ninja install

# CI image (stripped down version)
FROM public.ecr.aws/lts/ubuntu:22.04_stable AS ci
ARG DEBIAN_FRONTEND=noninteractive

# Update and install essentials
RUN apt update && apt upgrade -y && \
    apt install -y \
    build-essential cmake ninja-build git curl wget ca-certificates zip \
    software-properties-common dumb-init \
    python3-pip unzip sudo && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create dev sudo user
RUN useradd --create-home dev && \
    usermod --append --groups sudo dev && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Install node
ARG NODE_VERSION=24.15.0
ARG NODE_STANDALONE_NAME=node-v${NODE_VERSION}-linux-x64.tar.xz
ARG NODE_STANDALONE_HASH="472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6  ${NODE_STANDALONE_NAME}"
ARG NODE_STANDALONE_URL=https://nodejs.org/dist/v24.15.0/${NODE_STANDALONE_NAME}
RUN cd /tmp && \
    wget ${NODE_STANDALONE_URL} && \
    echo ${NODE_STANDALONE_HASH} | sha256sum -c && \
    tar -xJf ${NODE_STANDALONE_NAME} -C /usr/local --strip-components=1 --no-same-owner && \
    rm ${NODE_STANDALONE_NAME}

# Install verible
ARG VERIBLE_VERSION=v0.0-4053-g89d4d98a
ARG VERIBLE_BIN_NAME=verible-${VERIBLE_VERSION}-linux-static-x86_64.tar.gz
ARG VERIBLE_BIN_URL=https://github.com/chipsalliance/verible/releases/download/${VERIBLE_VERSION}/${VERIBLE_BIN_NAME}
ARG VERIBLE_BIN_HASH="1edc1f29c70d74213ed373e727183802d5a733e23f9ab9c74462f5b18b76f2c0  ${VERIBLE_BIN_NAME}"
RUN cd /tmp && \
    wget ${VERIBLE_BIN_URL} && \
    echo ${VERIBLE_BIN_HASH} | sha256sum -c && \
    tar -xf ${VERIBLE_BIN_NAME} -C /usr/local --strip-components=1 --no-same-owner && \
    rm ${VERIBLE_BIN_NAME}

# Install surelog (via pip for simplicity in CI)
ARG SURELOG_VERSION=1.84.1
ARG SURELOG_WHL_NAME=sc_surelog-${SURELOG_VERSION}-cp310-cp310-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
ARG SURELOG_WHL_URL=https://github.com/siliconcompiler/sc-surelog/releases/download/v${SURELOG_VERSION}/${SURELOG_WHL_NAME}
ARG SURELOG_WHL_HASH="fe7775681025cb90dcf16b5c176fcadc6c11212ed049c795ca3341168bf7d143  ${SURELOG_WHL_NAME}"
RUN cd /tmp && \
    wget ${SURELOG_WHL_URL} && \
    echo ${SURELOG_WHL_HASH} | sha256sum -c && \
    pip install ${SURELOG_WHL_NAME} uhdm==1.84 && \
    rm ${SURELOG_WHL_NAME}

# Install UHDM from builder
COPY --from=uhdm-builder /opt/uhdm /opt/uhdm
RUN ln -s /opt/uhdm/include/uhdm /usr/local/include/uhdm && \
    ln -s /opt/uhdm/lib/uhdm /usr/local/lib/uhdm && \
    ln -s /opt/uhdm/bin/uhdm-dump /usr/local/bin/uhdm-dump

# Install libraries for system testing (VS Code UI requirements)
# fonts-dejavu ensures 'DejaVu Sans Mono' is available as the monospace font,
# matching the font pinned in installStableTheme() for screenshot stability.
RUN apt update && \
    apt install -y xvfb libgtk-3-0 libgbm1 libasound2 libxss1 fonts-dejavu && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Global Playwright browser path
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/ms-playwright
RUN mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} && chmod -R 777 ${PLAYWRIGHT_BROWSERS_PATH}

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Devcontainer image (adds developer conveniences)
FROM ci AS dev

USER root
ARG DEBIAN_FRONTEND=noninteractive

# Install dev-specific tools
RUN apt update && \
    apt install -y \
    man make zsh vim procps gnupg gnupg2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Unminimize the system
RUN bash -c "yes | unminimize"

# Setup oh-my-zsh
USER dev
ARG DOCKER_OHMYZSH_SCRIPT_NAME=zsh-in-docker.sh
ARG DOCKER_OHMYZSH_SCRIPT_URL=https://github.com/deluan/zsh-in-docker/releases/download/v1.1.3/${DOCKER_OHMYZSH_SCRIPT_NAME}
ARG DOCKER_OHMYZSH_SCRIPT_HASH="ffa8175332ef01b500ace59d03ce7e2f3a7453651e9a37060974bb6536f0706b  ${DOCKER_OHMYZSH_SCRIPT_NAME}"
RUN cd /tmp && \
    wget ${DOCKER_OHMYZSH_SCRIPT_URL} && \
    echo ${DOCKER_OHMYZSH_SCRIPT_HASH} | sha256sum -c && \
    chmod +x ./${DOCKER_OHMYZSH_SCRIPT_NAME} && \
    ./${DOCKER_OHMYZSH_SCRIPT_NAME} -t robbyrussell -p git -p ssh-agent && \
    sudo rm ./${DOCKER_OHMYZSH_SCRIPT_NAME}

USER dev
