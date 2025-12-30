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
        name: '拖拽发送文件',
        description: '将文件拖拽到输入框发送',
        critical: false,
        steps: [
          '打开聊天窗口',
          '从文件管理器拖拽文件到输入框',
          '验证拖拽时显示视觉反馈',
          '释放文件',
          '验证文件自动识别类型（图片/视频/文件）',
          '验证文件发送流程与点击选择一致',
        ],
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
      {
        name: '历史消息无限滚动',
        description: '向上滚动自动加载更多历史消息',
        critical: true,
        steps: [
          '打开任意聊天窗口',
          '向上滚动到距离顶部 1/3 位置',
          '验证自动触发历史消息加载',
          '验证加载后视角保持不变',
          '验证加载完成后可继续滚动',
        ],
      },
      {
        name: '历史消息加载完毕提示',
        description: '滚动到最早消息时显示无更多记录',
        critical: false,
        steps: [
          '持续向上滚动直到没有更多消息',
          '验证顶部显示"无更多记录"提示',
        ],
      },
      {
        name: '图片尺寸预加载',
        description: '切换聊天时预加载图片尺寸避免布局偏移',
        critical: true,
        steps: [
          '切换到含有图片的聊天',
          '验证消息列表直接滚动到底部',
          '验证图片容器有正确的预设尺寸',
          '验证无明显的布局跳动',
        ],
      },
      {
        name: '后端图片尺寸整合',
        description: '发送图片时上传尺寸，接收时保存到本地',
        critical: true,
        steps: [
          '发送一张图片消息',
          '验证上传请求包含 image_width/image_height',
          '对方收到消息后验证本地数据库有尺寸信息',
          '重新进入聊天验证图片直接以正确尺寸渲染',
        ],
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
          '等待3秒后自动检测更新',
          '验证更新检测正常执行',
        ],
      },
      {
        name: '更新弹窗显示',
        description: '发现更新时顶部显示灵动岛风格弹窗',
        critical: true,
        steps: [
          '有新版本时验证顶部中间显示弹窗',
          '验证弹窗为白色透明毛玻璃+蓝色字体样式',
          '验证显示版本号和更新说明',
          '验证有"稍后"和"更新"按钮',
        ],
      },
      {
        name: '更新下载进度',
        description: '点击更新后显示下载进度',
        critical: true,
        steps: [
          '点击"更新"按钮',
          '验证显示进度条和百分比',
          '验证显示已下载/总大小',
          '验证显示当前代理链接',
        ],
      },
      {
        name: '更新错误处理',
        description: '下载失败时显示错误信息',
        critical: true,
        steps: [
          '模拟网络错误',
          '验证显示错误信息',
          '验证有"重试"按钮',
        ],
      },
      {
        name: '更新完成重启',
        description: '下载完成后提示重启',
        critical: true,
        steps: [
          '等待下载完成',
          '验证显示"立即重启"按钮',
          '点击后验证应用重启',
        ],
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
  {
    name: '设置模块',
    items: [
      {
        name: '设置面板打开',
        description: '点击设置按钮打开设置面板',
        critical: true,
        steps: [
          '点击侧边栏设置按钮',
          '验证设置面板正确显示',
          '验证会话列表被替换为设置面板',
        ],
      },
      {
        name: '设置面板关闭',
        description: '关闭设置面板返回会话列表',
        critical: true,
        steps: [
          '打开设置面板',
          '点击返回按钮',
          '验证返回会话列表',
          '或按 ESC 键关闭',
        ],
      },
      {
        name: '消息提示音开关',
        description: '启用/禁用消息提示音',
        critical: true,
        steps: [
          '打开设置面板',
          '找到消息提示音卡片',
          '切换开关状态',
          '验证设置生效',
        ],
      },
      {
        name: '提示音选择',
        description: '选择不同的消息提示音',
        critical: true,
        steps: [
          '打开设置面板',
          '点击不同的提示音选项',
          '验证选中状态变化',
          '验证播放预览音效',
        ],
      },
      {
        name: '提示音音量调节',
        description: '调节消息提示音音量',
        critical: false,
        steps: [
          '打开设置面板',
          '拖动音量滑块',
          '验证音量值变化',
          '点击试听验证音量',
        ],
      },
      {
        name: '提示音试听',
        description: '试听提示音效果',
        critical: false,
        steps: [
          '打开设置面板',
          '点击播放按钮',
          '验证音效播放',
          '点击停止按钮',
          '验证音效停止',
        ],
      },
      {
        name: '自定义提示音上传',
        description: '上传自定义 MP3 提示音',
        critical: false,
        steps: [
          '打开设置面板',
          '点击上传按钮',
          '选择 MP3 文件',
          '验证上传成功',
          '验证新音效出现在列表中',
        ],
      },
      {
        name: '自定义提示音删除',
        description: '删除自定义提示音',
        critical: false,
        steps: [
          '打开设置面板',
          '点击自定义音效的删除按钮',
          '确认删除',
          '验证音效从列表中移除',
        ],
      },
      {
        name: '设置持久化',
        description: '设置在重启后保持',
        critical: true,
        steps: [
          '修改提示音设置',
          '关闭并重启应用',
          '验证设置保持不变',
        ],
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

