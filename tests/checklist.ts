/**
 * 功能检查清单
 *
 * 定义应用必须正常工作的所有功能点
 * 用于预发布检查和回归测试
 */

export interface ChecklistItem {
  /** 功能名称 */
  name: string;
  /** 功能描述 */
  description: string;
  /** 是否为核心功能（必须通过） */
  critical: boolean;
  /** 测试步骤 */
  steps?: string[];
}

export interface FeatureCategory {
  /** 分类名称 */
  name: string;
  /** 功能列表 */
  items: ChecklistItem[];
}

/**
 * 完整功能检查清单
 */
export const FEATURE_CHECKLIST: FeatureCategory[] = [
  {
    name: '认证模块',
    items: [
      {
        name: '用户登录',
        description: '使用用户名密码登录',
        critical: true,
        steps: [
          '打开应用',
          '输入正确的用户名和密码',
          '点击登录按钮',
          '验证跳转到主页面',
        ],
      },
      {
        name: '自动登录',
        description: '已登录用户重启应用自动登录',
        critical: true,
        steps: [
          '登录成功后关闭应用',
          '重新打开应用',
          '验证自动跳转到主页面',
        ],
      },
      {
        name: '用户登出',
        description: '点击登出按钮退出登录',
        critical: true,
        steps: [
          '在主页面点击设置',
          '点击登出按钮',
          '验证跳转到登录页面',
        ],
      },
    ],
  },
  {
    name: '好友模块',
    items: [
      {
        name: '好友列表加载',
        description: '正确显示好友列表',
        critical: true,
        steps: [
          '登录后切换到好友标签',
          '验证好友列表正确显示',
          '验证头像和昵称正确',
        ],
      },
      {
        name: '添加好友',
        description: '通过搜索添加新好友',
        critical: false,
        steps: [
          '点击添加按钮',
          '搜索用户ID',
          '发送好友请求',
          '验证请求发送成功',
        ],
      },
      {
        name: '好友聊天',
        description: '与好友发送消息',
        critical: true,
        steps: [
          '点击好友进入聊天',
          '发送文本消息',
          '验证消息发送成功',
          '验证对方收到消息',
        ],
      },
    ],
  },
  {
    name: '群聊模块',
    items: [
      {
        name: '群列表加载',
        description: '正确显示群聊列表',
        critical: true,
        steps: [
          '切换到群聊标签',
          '验证群列表正确显示',
        ],
      },
      {
        name: '群消息发送',
        description: '在群聊中发送消息',
        critical: true,
        steps: [
          '点击群聊进入',
          '发送文本消息',
          '验证消息发送成功',
        ],
      },
      {
        name: '创建群聊',
        description: '创建新的群聊',
        critical: false,
        steps: [
          '点击添加按钮',
          '选择创建群聊',
          '输入群名称',
          '选择群成员',
          '验证群创建成功',
        ],
      },
    ],
  },
  {
    name: '消息模块',
    items: [
      {
        name: '发送文本消息',
        description: '发送纯文本消息',
        critical: true,
      },
      {
        name: '发送图片消息',
        description: '发送图片文件',
        critical: true,
        steps: [
          '点击附件按钮',
          '选择图片文件',
          '验证图片发送成功',
          '验证图片正确显示',
        ],
      },
      {
        name: '发送文件消息',
        description: '发送普通文件',
        critical: false,
      },
      {
        name: '消息撤回',
        description: '撤回已发送的消息',
        critical: false,
      },
      {
        name: '消息已读状态',
        description: '显示消息已读/未读状态',
        critical: false,
      },
    ],
  },
  {
    name: '文件模块',
    items: [
      {
        name: '文件上传',
        description: '上传文件到服务器',
        critical: true,
      },
      {
        name: '文件下载',
        description: '下载文件到本地',
        critical: true,
      },
      {
        name: '图片预览',
        description: '点击图片打开预览窗口',
        critical: true,
      },
      {
        name: '视频播放',
        description: '播放视频消息',
        critical: false,
      },
    ],
  },
  {
    name: '会议模块',
    items: [
      {
        name: '创建会议',
        description: '创建新的视频会议',
        critical: false,
      },
      {
        name: '加入会议',
        description: '通过会议号加入会议',
        critical: false,
      },
      {
        name: '屏幕共享',
        description: '在会议中共享屏幕',
        critical: false,
      },
      {
        name: '麦克风控制',
        description: '开启/关闭麦克风',
        critical: false,
      },
      {
        name: '摄像头控制',
        description: '开启/关闭摄像头',
        critical: false,
      },
    ],
  },
  {
    name: '更新模块',
    items: [
      {
        name: '检测更新',
        description: '启动时自动检测更新',
        critical: true,
        steps: [
          '启动应用',
          '观察控制台日志',
          '验证更新检测正常执行',
        ],
      },
      {
        name: '更新通知',
        description: '发现更新时发送系统通知',
        critical: true,
      },
      {
        name: '静默下载',
        description: '后台下载更新包',
        critical: true,
      },
    ],
  },
  {
    name: 'UI 模块',
    items: [
      {
        name: '侧边栏导航',
        description: '侧边栏标签切换正常',
        critical: true,
      },
      {
        name: '聊天面板',
        description: '聊天界面正确显示',
        critical: true,
      },
      {
        name: '托盘图标',
        description: '系统托盘图标正常显示',
        critical: true,
        steps: [
          '启动应用',
          '验证托盘图标显示',
          '点击关闭按钮',
          '验证窗口隐藏到托盘',
          '点击托盘图标',
          '验证窗口恢复显示',
        ],
      },
      {
        name: '窗口最小化到托盘',
        description: '点击关闭按钮最小化到托盘',
        critical: true,
      },
    ],
  },
];

/**
 * 获取所有核心功能
 */
export function getCriticalFeatures(): ChecklistItem[] {
  return FEATURE_CHECKLIST.flatMap((category) =>
    category.items.filter((item) => item.critical)
  );
}

/**
 * 获取功能总数
 */
export function getFeatureCount(): {
  total: number;
  critical: number;
} {
  const allItems = FEATURE_CHECKLIST.flatMap((c) => c.items);
  return {
    total: allItems.length,
    critical: allItems.filter((i) => i.critical).length,
  };
}

/**
 * 生成人工检查清单文本
 */
export function generateChecklistText(): string {
  const lines: string[] = [
    '========================================',
    '        Huanvae Chat 发布前检查清单',
    '========================================',
    '',
  ];

  for (const category of FEATURE_CHECKLIST) {
    lines.push(`## ${category.name}`);
    lines.push('');
    for (const item of category.items) {
      const marker = item.critical ? '[必须]' : '[可选]';
      lines.push(`  [ ] ${marker} ${item.name}`);
      if (item.steps) {
        for (const step of item.steps) {
          lines.push(`      - ${step}`);
        }
      }
    }
    lines.push('');
  }

  const { total, critical } = getFeatureCount();
  lines.push('========================================');
  lines.push(`总计: ${total} 项功能, 其中 ${critical} 项为核心功能`);
  lines.push('========================================');

  return lines.join('\n');
}

