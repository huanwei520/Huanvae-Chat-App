#!/bin/sh
# Huanvae Chat - deb 包卸载后脚本
# 功能：清理安装时添加的防火墙规则
#
# 注意：
# - 不会停止或卸载 avahi-daemon (其他程序可能依赖)
# - 仅清理本应用添加的防火墙规则

set -e

case "$1" in
    remove|purge)
        echo "[Huanvae Chat] 正在清理防火墙规则..."

        # ========== 清理 UFW 规则 ==========
        if command -v ufw >/dev/null 2>&1; then
            UFW_STATUS=$(ufw status 2>/dev/null | head -1 || echo "inactive")
            if echo "$UFW_STATUS" | grep -q "active"; then
                # 删除 mDNS 规则
                ufw delete allow 5353/udp 2>/dev/null || true
                # 删除传输端口规则
                ufw delete allow 53317/tcp 2>/dev/null || true
                echo "[Huanvae Chat] ✓ UFW 规则已清理"
            fi
        fi

        # ========== 清理 firewalld 规则 ==========
        if command -v firewall-cmd >/dev/null 2>&1; then
            if firewall-cmd --state >/dev/null 2>&1; then
                # 注意：不删除 mdns 服务，因为其他程序可能需要
                # 仅删除传输端口
                firewall-cmd --permanent --remove-port=53317/tcp 2>/dev/null || true
                firewall-cmd --reload 2>/dev/null || true
                echo "[Huanvae Chat] ✓ firewalld 规则已清理"
            fi
        fi

        echo "[Huanvae Chat] ✓ 清理完成"
        ;;

    upgrade|failed-upgrade|abort-install|abort-upgrade|disappear)
        ;;

    *)
        echo "postrm called with unknown argument \`$1'" >&2
        exit 1
        ;;
esac

exit 0
