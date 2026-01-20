#!/bin/sh
# Huanvae Chat - deb 包安装后脚本
# 功能：自动配置局域网传输所需的系统服务和防火墙
#
# 配置项：
# - 检查并启用 avahi-daemon (mDNS 设备发现)
# - 配置 UFW 防火墙规则 (如果启用)
# - 配置 firewalld 规则 (如果启用)

set -e

case "$1" in
    configure)
        echo "[Huanvae Chat] 正在配置局域网传输功能..."

        # ========== 检查并配置 avahi-daemon ==========
        # avahi-daemon 是 Linux 上的 mDNS/DNS-SD 实现
        if command -v systemctl >/dev/null 2>&1; then
            # 检查 avahi-daemon 是否已安装
            if systemctl list-unit-files avahi-daemon.service >/dev/null 2>&1; then
                # 检查服务状态
                if ! systemctl is-active --quiet avahi-daemon; then
                    echo "[Huanvae Chat] 正在启动 avahi-daemon 服务..."
                    systemctl start avahi-daemon 2>/dev/null || true
                fi
                # 确保开机自启
                if ! systemctl is-enabled --quiet avahi-daemon 2>/dev/null; then
                    echo "[Huanvae Chat] 正在启用 avahi-daemon 开机自启..."
                    systemctl enable avahi-daemon 2>/dev/null || true
                fi
                echo "[Huanvae Chat] ✓ avahi-daemon 已配置"
            else
                echo "[Huanvae Chat] ⚠ avahi-daemon 未安装，设备发现功能可能受限"
                echo "[Huanvae Chat]   安装方法: sudo apt install avahi-daemon"
            fi
        fi

        # ========== 配置 UFW 防火墙 (Ubuntu/Debian) ==========
        if command -v ufw >/dev/null 2>&1; then
            # 检查 UFW 是否启用
            UFW_STATUS=$(ufw status 2>/dev/null | head -1 || echo "inactive")
            if echo "$UFW_STATUS" | grep -q "active"; then
                echo "[Huanvae Chat] 检测到 UFW 防火墙已启用，正在添加规则..."
                
                # 添加 mDNS 规则 (UDP 5353)
                if ! ufw status | grep -q "5353/udp"; then
                    ufw allow 5353/udp comment "Huanvae Chat mDNS" 2>/dev/null || true
                    echo "[Huanvae Chat] ✓ 已添加 mDNS 规则 (UDP 5353)"
                fi
                
                # 添加传输端口规则 (TCP 53317)
                if ! ufw status | grep -q "53317/tcp"; then
                    ufw allow 53317/tcp comment "Huanvae Chat LAN Transfer" 2>/dev/null || true
                    echo "[Huanvae Chat] ✓ 已添加传输端口规则 (TCP 53317)"
                fi
            else
                echo "[Huanvae Chat] UFW 防火墙未启用，跳过配置"
            fi
        fi

        # ========== 配置 firewalld (Fedora/RHEL/CentOS) ==========
        if command -v firewall-cmd >/dev/null 2>&1; then
            # 检查 firewalld 是否运行
            if firewall-cmd --state >/dev/null 2>&1; then
                echo "[Huanvae Chat] 检测到 firewalld 正在运行，正在添加规则..."
                
                # 添加 mDNS 服务
                if ! firewall-cmd --list-services 2>/dev/null | grep -q "mdns"; then
                    firewall-cmd --permanent --add-service=mdns 2>/dev/null || true
                    echo "[Huanvae Chat] ✓ 已添加 mDNS 服务"
                fi
                
                # 添加传输端口
                if ! firewall-cmd --list-ports 2>/dev/null | grep -q "53317/tcp"; then
                    firewall-cmd --permanent --add-port=53317/tcp 2>/dev/null || true
                    echo "[Huanvae Chat] ✓ 已添加传输端口 (TCP 53317)"
                fi
                
                # 重载防火墙配置
                firewall-cmd --reload 2>/dev/null || true
            else
                echo "[Huanvae Chat] firewalld 未运行，跳过配置"
            fi
        fi

        echo "[Huanvae Chat] ✓ 局域网传输配置完成"
        ;;

    abort-upgrade|abort-remove|abort-deconfigure)
        ;;

    *)
        echo "postinst called with unknown argument \`$1'" >&2
        exit 1
        ;;
esac

exit 0
