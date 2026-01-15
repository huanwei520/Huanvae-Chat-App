#!/bin/bash
set -e

REPO_URL="https://huanwei520.github.io/Huanvae-Chat-App"

echo "🚀 添加 Huanvae Chat APT 仓库..."

# 下载并安装 GPG 密钥
curl -fsSL "${REPO_URL}/gpg.key" | \
  sudo gpg --dearmor -o /usr/share/keyrings/huanvae-chat.gpg

# 添加仓库源（仅支持 amd64 架构）
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/huanvae-chat.gpg] ${REPO_URL} stable main" | \
  sudo tee /etc/apt/sources.list.d/huanvae-chat.list > /dev/null

# 更新并安装
sudo apt update
sudo apt install -y huanvae-chat-app

echo ""
echo "✅ 安装完成！"
echo "   运行: huanvae-chat"
echo "   更新: sudo apt update && sudo apt upgrade"
