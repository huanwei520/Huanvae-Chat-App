# Huanvae Chat APT Repository

## 一键安装

```bash
curl -fsSL https://huanwei520.github.io/Huanvae-Chat-App/install.sh | bash
```

## 手动安装

```bash
# 1. 添加 GPG 密钥
curl -fsSL https://huanwei520.github.io/Huanvae-Chat-App/gpg.key | \
  sudo gpg --dearmor -o /usr/share/keyrings/huanvae-chat.gpg

# 2. 添加仓库源（仅支持 amd64 架构）
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/huanvae-chat.gpg] https://huanwei520.github.io/Huanvae-Chat-App stable main" | \
  sudo tee /etc/apt/sources.list.d/huanvae-chat.list

# 3. 安装
sudo apt update
sudo apt install huanvae-chat-app
```

## 更新

```bash
sudo apt update
sudo apt upgrade
```

## 卸载

```bash
sudo apt remove huanvae-chat-app
sudo rm /etc/apt/sources.list.d/huanvae-chat.list
sudo rm /usr/share/keyrings/huanvae-chat.gpg
```
