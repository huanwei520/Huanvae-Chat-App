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
        name: '登录后消息同步',
        description: '登录后自动同步所有会话的增量消息',
        critical: true,
        steps: [
          '登录账号',
          '等待好友和群聊列表加载完成',
          '验证消息列表顶部显示同步进度横幅',
          '验证横幅显示"正在同步消息... (X/Y)"',
          '验证同步完成后显示"已同步 X 条新消息"',
          '验证横幅 1.5 秒后自动淡出消失',
        ],
      },
      {
        name: '同步状态重试',
        description: '同步失败时可点击重试',
        critical: false,
        steps: [
          '模拟网络错误导致同步失败',
          '验证横幅显示"同步失败，点击重试"',
          '点击横幅验证重新开始同步',
        ],
      },
      {
        name: '移动端页面切换不触发同步横幅',
        description: '移动端切换消息/通讯录标签时不重复显示同步横幅',
        critical: true,
        steps: [
          '移动端登录后等待同步横幅消失',
          '切换到通讯录标签',
          '切换回消息标签',
          '验证不会再次显示同步横幅',
          '进入聊天页面后返回',
          '验证不会再次显示同步横幅',
        ],
      },
      {
        name: 'WebSocket 重连后触发同步',
        description: '断线重连后自动触发消息同步并显示横幅',
        critical: true,
        steps: [
          '登录后等待同步完成',
          '模拟网络断开（如切换飞行模式）',
          '恢复网络连接',
          '验证 WebSocket 重连后显示同步横幅',
          '验证同步完成后横幅自动消失',
        ],
      },
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
        name: '剪贴板粘贴图片（桌面端）',
        description: '在输入框中按 Ctrl+V 粘贴剪贴板图片',
        critical: true,
        steps: [
          '桌面端打开聊天窗口',
          '使用截图工具截取图片或复制图片',
          '在输入框中按 Ctrl+V（或 Cmd+V）',
          '验证图片自动识别并开始上传',
          '验证图片发送成功',
          '验证移动端粘贴图片时不触发此功能',
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
        description: '上传文件到服务器（Android 使用 tauri-plugin-android-fs 处理 content:// URI）',
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
      {
        name: '视频下载进度显示',
        description: '点击视频缩略图时显示圆形下载进度',
        critical: true,
        steps: [
          '打开包含未缓存视频的聊天',
          '点击视频缩略图',
          '验证缩略图上显示圆形下载进度',
          '验证同时打开独立播放窗口',
          '验证下载完成后缩略图显示本地文件标识',
          '验证独立窗口自动切换到本地文件源',
        ],
      },
      {
        name: '在文件夹中显示',
        description: '右键菜单打开本地文件所在目录',
        critical: false,
        steps: [
          '打开包含已缓存文件的聊天',
          '右键点击图片/视频/文件消息',
          '验证显示"在文件夹中显示"选项',
          '点击后验证系统文件管理器打开并定位文件',
        ],
      },
      {
        name: '大文件本地链接',
        description: '大于阈值的文件不复制，使用原始路径',
        critical: true,
        steps: [
          '发送一个≥阈值（默认100MB）的文件',
          '验证发送成功',
          '验证本地不创建副本',
          '验证消息中显示正确',
          '移动原始文件后验证自动从服务器下载',
        ],
      },
      {
        name: '大文件阈值设置',
        description: '用户可调整大文件直连阈值',
        critical: true,
        steps: [
          '打开设置面板',
          '在"存储与数据"分组找到"大文件直连阈值"',
          '修改阈值数值（如50MB）',
          '发送一个介于新旧阈值之间的文件',
          '验证文件按新阈值判断是否直连',
          '重启应用后验证阈值设置保留',
        ],
      },
      {
        name: '媒体预览窗口后台下载',
        description: '预览窗口自动缓存远程文件到本地',
        critical: true,
        steps: [
          '打开一个包含未缓存图片/视频的聊天',
          '点击图片/视频打开预览窗口',
          '等待加载完成后验证控制台显示后台下载日志',
          '关闭预览窗口，再次点击同一文件',
          '验证现在显示"本地文件"标识',
          '删除或移动本地缓存文件后再次预览',
          '验证自动从服务器获取并重新缓存（后端验证文件存在性）',
        ],
      },
      {
        name: '大文件下载性能',
        description: '局域网内大文件下载速度优化（异步IO+8MB缓冲）',
        critical: true,
        steps: [
          '准备一个100MB以上的视频文件并上传到服务器',
          '清除本地缓存',
          '点击视频开始下载',
          '验证下载进度正常显示（每1%更新）',
          '验证局域网环境下下载速度接近网络带宽上限',
          '验证下载完成后文件完整可播放',
          '对比优化前后下载速度（预期提升10倍以上）',
        ],
      },
      {
        name: 'URL 自动优化',
        description: '预签名 URL 自动替换为当前登录的服务器地址',
        critical: true,
        steps: [
          '使用局域网 IP 登录（如 http://192.168.x.x）',
          '打开包含远程文件的聊天',
          '打开控制台查看日志',
          '验证显示 "[Network] URL 优化" 日志',
          '验证预签名 URL 已替换为登录地址',
          '使用公网域名登录验证 URL 保持不变',
        ],
      },
      {
        name: '文档下载进度显示',
        description: '点击下载按钮时显示圆形下载进度',
        critical: true,
        steps: [
          '打开包含未缓存文档的聊天',
          '点击文档消息的下载按钮',
          '验证下载按钮变为圆形进度条',
          '验证进度百分比正确更新',
          '验证下载完成后进度条消失',
        ],
      },
      {
        name: '桌面端文档消息点击行为',
        description: '桌面端点击文档消息直接打开文件夹或触发下载',
        critical: true,
        steps: [
          '打开包含未缓存文档的聊天',
          '桌面端：点击文档消息',
          '验证触发下载并显示进度',
          '等待下载完成后再次点击',
          '验证系统文件管理器打开并选中文件',
          '移动端：点击文档消息打开预览模态框',
        ],
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
        description: '在会议中共享屏幕（桌面端专用，移动端不支持）',
        critical: false,
        steps: [
          '仅桌面端支持',
          '点击屏幕共享按钮选择窗口',
          '验证共享内容正确显示',
          '移动端：验证屏幕共享按钮已隐藏',
        ],
      },
      {
        name: '移动端视频会议',
        description: '移动端全屏会议页面',
        critical: false,
        steps: [
          '点击抽屉菜单中的"视频会议"',
          '验证进入全屏会议页面',
          '验证摄像头/麦克风权限请求弹窗',
          '验证本地视频流显示',
          '验证屏幕共享按钮已隐藏',
          '验证手势返回可关闭页面',
        ],
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
      {
        name: '权限被拒绝恢复',
        description: '权限被拒绝时显示跨平台修复指南',
        critical: true,
        steps: [
          '拒绝麦克风/摄像头权限（或在系统设置中禁用）',
          '在会议中点击麦克风或摄像头按钮',
          '验证显示警告提示',
          '验证自动弹出权限修复引导弹窗',
          '验证显示当前操作系统名称',
          '验证显示设置路径说明',
          '验证显示可复制的修复命令',
          '点击复制按钮验证命令复制到剪贴板',
          '点击"打开系统设置"验证正确打开设置页面',
          '在系统设置中授予权限后点击"重试"',
          '验证权限恢复正常工作',
        ],
      },
      {
        name: 'Windows 权限修复命令',
        description: 'Windows 平台提供正确的设置 URI',
        critical: false,
        steps: [
          '在 Windows 上触发权限拒绝',
          '验证显示 start ms-settings:privacy-webcam 等命令',
          '复制并执行命令验证打开正确的设置页面',
        ],
      },
      {
        name: 'macOS 权限修复命令',
        description: 'macOS 平台提供 tccutil 重置命令',
        critical: false,
        steps: [
          '在 macOS 上触发权限拒绝',
          '验证显示 tccutil reset Camera 等命令',
          '验证显示需要重启应用的提示',
        ],
      },
      {
        name: 'Linux 权限修复命令',
        description: 'Ubuntu 平台提供用户组和服务命令',
        critical: false,
        steps: [
          '在 Ubuntu 上触发权限拒绝',
          '验证显示 sudo usermod -aG video $USER 等命令',
          '验证显示 PipeWire 相关命令',
          '验证显示需要管理员权限的标识',
        ],
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
      {
        name: 'Android 自动更新',
        description: 'Android 平台应用内 APK 下载安装（与桌面端逻辑隔离）',
        critical: true,
        steps: [
          'Android 设备启动应用',
          '等待3秒后自动检测 android-latest.json',
          '验证多代理自动切换（edgeone -> cdn -> hk -> gh-proxy -> 直连）',
          '有新版本时验证顶部弹窗显示',
          '点击"更新"按钮验证下载进度显示',
          '验证下载完成后弹出系统安装器',
          '首次安装验证请求"安装未知应用"权限',
          '验证安装完成后应用替换成功',
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
      {
        name: '窗口大小初始化',
        description: '首次启动按屏幕百分比设置窗口大小',
        critical: true,
        steps: [
          '删除窗口状态缓存',
          '启动应用',
          '验证窗口大小约为屏幕的60%×75%',
          '验证窗口居中显示',
        ],
      },
      {
        name: '窗口状态记忆',
        description: '重启后恢复上次的窗口位置和大小',
        critical: true,
        steps: [
          '调整窗口大小和位置',
          '关闭应用',
          '重新打开应用',
          '验证窗口大小和位置与上次一致',
        ],
      },
    ],
  },
  {
    name: '个人资料模块',
    items: [
      {
        name: '个人资料弹窗',
        description: '打开个人资料弹窗',
        critical: true,
        steps: [
          '点击侧边栏头像',
          '验证个人资料弹窗正确显示',
          '验证显示头像、昵称、ID',
        ],
      },
      {
        name: '修改昵称',
        description: '点击昵称进行编辑',
        critical: true,
        steps: [
          '打开个人资料弹窗',
          '点击昵称区域',
          '验证进入编辑模式（显示输入框）',
          '输入新昵称',
          '按回车或点击外部保存',
          '验证昵称更新成功',
          '验证本地账号缓存同步更新',
        ],
      },
      {
        name: '头像上传',
        description: '上传新头像',
        critical: false,
        steps: [
          '点击头像区域',
          '选择图片文件',
          '验证上传进度显示',
          '验证头像更新成功',
        ],
      },
      {
        name: '修改邮箱和签名',
        description: '更新邮箱和个性签名',
        critical: false,
        steps: [
          '打开个人资料弹窗',
          '切换到基本信息标签',
          '修改邮箱或签名',
          '点击保存',
          '验证保存成功',
        ],
      },
      {
        name: '修改密码',
        description: '修改账户密码',
        critical: false,
        steps: [
          '打开个人资料弹窗',
          '切换到修改密码标签',
          '输入旧密码和新密码',
          '点击保存',
          '验证密码修改成功',
        ],
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
          '找到消息提示音设置行',
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
      {
        name: '设备管理入口',
        description: '打开设备管理面板',
        critical: true,
        steps: [
          '打开设置面板',
          '点击设备管理',
          '验证设备管理面板显示',
        ],
      },
      {
        name: '设备信息获取',
        description: '登录时正确获取并上传设备信息',
        critical: true,
        steps: [
          '执行登录操作',
          '验证设备信息包含计算机名和操作系统',
          '验证 MAC 地址正确获取',
          '验证同一设备多次登录不会创建多个设备记录',
        ],
      },
      {
        name: '设备列表加载',
        description: '正确显示登录设备列表',
        critical: true,
        steps: [
          '打开设备管理面板',
          '验证设备列表正确加载',
          '验证当前设备有标识',
        ],
      },
      {
        name: '删除其他设备',
        description: '删除非当前设备（乐观更新）',
        critical: true,
        steps: [
          '在设备列表中点击其他设备的删除按钮',
          '验证设备立即从列表中移除（无需等待）',
          '验证有流畅的退出动画效果',
          '验证当前登录状态不受影响',
        ],
      },
      {
        name: '删除失败回滚',
        description: '删除设备失败时恢复列表',
        critical: false,
        steps: [
          '模拟网络错误',
          '点击删除按钮',
          '验证设备先消失后恢复',
          '验证显示错误信息',
        ],
      },
      {
        name: '删除当前设备',
        description: '删除当前设备需要确认',
        critical: false,
        steps: [
          '点击当前设备的删除按钮',
          '验证显示确认对话框',
          '确认后验证Token失效',
        ],
      },
      {
        name: '一键删除所有其他设备',
        description: '批量删除除当前设备外的所有设备',
        critical: false,
        steps: [
          '打开设备管理面板',
          '验证显示"删除其他所有设备"按钮',
          '点击按钮后验证显示确认对话框',
          '确认后验证所有其他设备被删除',
          '验证当前设备保留',
        ],
      },
      {
        name: '检查更新按钮状态',
        description: '检查更新按钮状态正确变化',
        critical: true,
        steps: [
          '打开设置面板',
          '点击检查更新按钮',
          '验证按钮显示"检查中..."',
          '验证检查完成后按钮状态更新',
        ],
      },
      {
        name: '已是最新版本',
        description: '无新版本时按钮显示已是最新版本',
        critical: true,
        steps: [
          '当应用为最新版本时',
          '点击检查更新',
          '验证按钮变为"已是最新版本"并禁用',
        ],
      },
      {
        name: '有新版本弹出更新窗口',
        description: '发现新版本时弹出更新弹窗',
        critical: true,
        steps: [
          '当有新版本可用时',
          '点击检查更新',
          '验证顶部弹出更新提示窗口',
          '验证显示版本号和更新说明',
        ],
      },
      {
        name: '主题设置窗口打开',
        description: '点击主题设置打开独立编辑窗口',
        critical: true,
        steps: [
          '打开设置面板',
          '在外观分组找到主题设置',
          '点击主题设置行',
          '验证打开独立的主题编辑窗口',
          '验证窗口不影响主窗口正常使用',
        ],
      },
      {
        name: '主题预设切换',
        description: '切换默认或自定义预设',
        critical: true,
        steps: [
          '打开主题编辑窗口',
          '点击默认预设验证选中状态',
          '点击自定义预设验证显示颜色选择器',
          '验证设置持久化（重启后保持选择）',
        ],
      },
      {
        name: '自定义主题颜色',
        description: '自定义主色和强调色',
        critical: false,
        steps: [
          '打开主题编辑窗口',
          '选择自定义预设',
          '点击主色色块打开颜色选择器',
          '选择新颜色验证界面即时变化',
          '验证自定义颜色持久化',
        ],
      },
      {
        name: '毛玻璃效果调整',
        description: '自定义毛玻璃基础颜色和效果参数',
        critical: false,
        steps: [
          '打开主题编辑窗口',
          '选择自定义预设',
          '验证显示毛玻璃效果设置区域',
          '调整基础颜色验证界面即时变化',
          '调整模糊度、饱和度、边框透明度滑块',
          '验证聊天窗口毛玻璃效果实时更新',
          '验证设置持久化（重启后保持）',
        ],
      },
      {
        name: '高级透明度层级设置',
        description: '精细控制各 UI 层级的独立透明度',
        critical: false,
        steps: [
          '打开主题编辑窗口',
          '选择自定义预设',
          '点击"高级透明度设置"展开面板',
          '验证显示六个分组（弹窗层/主背景层/卡片层/面板层/辅助层/遮罩层）',
          '验证每个分组有对应的透明度滑块',
          '调整单个透明度滑块（如 80%）',
          '验证对应 UI 组件（如消息气泡）透明度即时变化',
          '验证滑块数值显示正确',
          '收起面板后重新展开，验证设置保持',
          '验证设置持久化（重启后保持）',
        ],
      },
      {
        name: '跨窗口主题同步',
        description: '主题编辑窗口修改后主窗口实时更新',
        critical: true,
        steps: [
          '打开主题编辑窗口',
          '保持主窗口可见',
          '在主题编辑窗口修改颜色',
          '验证主窗口界面同步变化',
          '关闭主题编辑窗口验证设置保持',
        ],
      },
      {
        name: '主题恢复默认',
        description: '重置主题为默认设置',
        critical: false,
        steps: [
          '打开主题编辑窗口',
          '修改主题设置',
          '点击恢复默认按钮',
          '验证主题恢复到默认预设',
        ],
      },
      {
        name: '移动端主题设置页面',
        description: '移动端使用独立页面进行主题设置（非独立窗口）',
        critical: true,
        steps: [
          '在移动端打开设置页面',
          '点击主题设置行',
          '验证打开主题设置页面（全屏页面，非独立窗口）',
          '验证显示预设选择器和自定义选项',
          '切换主题预设验证界面即时变化',
          '点击返回按钮返回设置页面',
          '使用手势返回验证正确返回',
        ],
      },
    ],
  },
  {
    name: '局域网传输',
    items: [
      {
        name: '启动局域网传输服务',
        description: '打开局域网传输弹窗自动启动服务',
        critical: true,
        steps: [
          '点击侧边栏局域网传输按钮',
          '验证弹窗打开',
          '验证服务状态显示"服务运行中"',
        ],
      },
      {
        name: '设备发现',
        description: '自动发现局域网内其他设备',
        critical: true,
        steps: [
          '确保局域网内有另一台设备运行此应用',
          '打开局域网传输弹窗',
          '验证发现的设备列表显示',
          '验证设备名和用户信息正确',
        ],
      },
      {
        name: 'mDNS 服务类型合规',
        description: '服务类型名符合 RFC 6763 规范（不超过 15 字节）',
        critical: true,
        steps: [
          '打开局域网传输窗口',
          '查看调试信息中的服务类型',
          '验证服务类型为 _hvae-xfer._tcp.local.',
          '验证服务注册成功（无 15 字节限制错误）',
          '在另一台设备使用 avahi-browse _hvae-xfer._tcp -t 验证能发现服务',
        ],
      },
      {
        name: '服务状态同步',
        description: '前后端服务状态实时同步',
        critical: true,
        steps: [
          '打开局域网传输窗口',
          '验证显示"服务运行中"状态',
          '关闭窗口验证服务停止',
          '重新打开窗口验证服务自动重启',
          '验证状态变化即时反映在 UI 上',
        ],
      },
      {
        name: '跨平台设备互发现',
        description: 'Windows 和 Linux 设备互相发现',
        critical: true,
        steps: [
          '在 Windows 上打开局域网传输窗口',
          '在 Linux 上打开局域网传输窗口',
          '验证 Windows 能看到 Linux 设备',
          '验证 Linux 能看到 Windows 设备',
          '验证设备信息（名称、用户昵称、IP）正确显示',
        ],
      },
      {
        name: '发送文件',
        description: '选择文件发送到目标设备',
        critical: true,
        steps: [
          '在设备列表中点击目标设备',
          '选择要发送的文件',
          '验证传输进度显示',
          '验证传输完成后文件保存到目标设备',
        ],
      },
      {
        name: '接收文件',
        description: '接收其他设备发送的文件',
        critical: true,
        steps: [
          '从另一台设备发起文件传输',
          '验证收到连接请求弹窗',
          '点击接受',
          '验证文件接收并保存到本地',
        ],
      },
      {
        name: '大文件传输',
        description: '大文件分块传输和校验',
        critical: false,
        steps: [
          '选择一个大于 100MB 的文件',
          '发送到目标设备',
          '验证传输进度正常显示',
          '验证传输完成后文件完整性（SHA-256 校验）',
        ],
      },
      {
        name: '取消传输',
        description: '传输过程中取消',
        critical: false,
        steps: [
          '开始传输一个文件',
          '点击取消按钮',
          '验证传输停止',
          '验证任务从列表中移除',
        ],
      },
      {
        name: '网络诊断',
        description: '自动检测网络配置问题并提供解决方案',
        critical: false,
        steps: [
          '打开局域网传输窗口',
          '点击调试信息按钮（🔧图标）',
          '点击"开始检测"按钮',
          '验证显示诊断结果列表',
          '验证每项检查显示状态（✅/⚠️/❌）',
          '对于有问题的项，验证显示修复建议和命令',
        ],
      },
      {
        name: '诊断修复命令复制',
        description: '一键复制修复命令到剪贴板',
        critical: false,
        steps: [
          '执行网络诊断',
          '找到有修复命令的诊断项',
          '点击复制按钮',
          '验证命令已复制到剪贴板',
          '以管理员权限运行命令',
          '重新执行诊断验证问题已解决',
        ],
      },
    ],
  },
  {
    name: 'Linux 安装与更新',
    items: [
      {
        name: 'deb 包安装',
        description: '通过 apt 安装 deb 包',
        critical: true,
        steps: [
          '下载 deb 包',
          '执行 sudo apt install ./Huanvae-Chat-App_x.x.x_amd64.deb',
          '验证安装到 /opt/huanvae-chat/',
          '验证符号链接 /usr/local/bin/huanvae-chat 存在',
          '运行 huanvae-chat 命令验证启动',
        ],
      },
      {
        name: '用户数据目录',
        description: 'Linux 系统安装后用户数据存储在 home 目录',
        critical: true,
        steps: [
          '使用 deb 包安装应用',
          '登录并使用应用',
          '验证数据保存到 ~/huanvae-chat-app/data/',
          '验证普通用户可以读写该目录',
        ],
      },
      {
        name: 'APT 仓库配置',
        description: '安装后自动配置 APT 仓库源',
        critical: false,
        steps: [
          '安装 deb 包',
          '验证 /etc/apt/sources.list.d/huanvae-chat.list 存在',
          '验证 /usr/share/keyrings/huanvae-chat.gpg 存在',
          '执行 sudo apt update 验证仓库可访问',
        ],
      },
      {
        name: 'APT 更新',
        description: '通过 apt upgrade 更新应用',
        critical: false,
        steps: [
          '发布新版本后等待仓库更新',
          '执行 sudo apt update',
          '执行 sudo apt upgrade',
          '验证应用更新到新版本',
        ],
      },
      {
        name: '卸载清理',
        description: '卸载时清理所有配置',
        critical: false,
        steps: [
          '执行 sudo apt remove huanvae-chat-app',
          '验证 /opt/huanvae-chat/ 已删除',
          '验证 APT 仓库配置已删除',
          '验证符号链接已删除',
        ],
      },
    ],
  },
  // ============== 低代码编辑器模块 ==============
  {
    name: '低代码编辑器',
    items: [
      {
        name: '侧边栏入口',
        description: '桌面端侧边栏显示低代码编辑器按钮',
        critical: true,
        steps: [
          '在桌面端登录应用',
          '验证侧边栏有低代码编辑器图标',
          '验证移动端不显示该按钮',
        ],
      },
      {
        name: '独立窗口打开',
        description: '点击按钮打开独立编辑器窗口',
        critical: true,
        steps: [
          '点击侧边栏低代码按钮',
          '验证打开新的独立窗口',
          '验证窗口标题为"低代码编辑器"',
          '再次点击按钮验证聚焦已有窗口',
        ],
      },
      {
        name: '画布渲染',
        description: 'React Flow 画布正确渲染',
        critical: true,
        steps: [
          '打开低代码编辑器窗口',
          '验证三栏布局（算子面板、画布、属性面板）',
          '验证画布有网格背景',
          '验证画布可缩放和平移',
          '验证控制面板和小地图存在',
        ],
      },
      {
        name: '数据传递',
        description: '窗口数据通过 URL 参数正确传递',
        critical: true,
        steps: [
          '从主窗口打开低代码编辑器',
          '验证编辑器窗口能获取用户信息和服务器地址',
          '验证算子面板能加载算子列表',
        ],
      },
      {
        name: '算子拖放',
        description: '算子可拖放到画布创建节点',
        critical: true,
        steps: [
          '从左侧算子面板拖动算子到画布',
          '验证画布上创建对应节点',
          '验证节点显示输入/输出端口',
          '验证多次拖放创建多个节点',
        ],
      },
      {
        name: '节点连线',
        description: '节点之间可创建连接',
        critical: true,
        steps: [
          '创建多个算子节点',
          '从输出端口拖动到输入端口',
          '验证连线正确创建',
          '验证连线有动画效果',
        ],
      },
      {
        name: '属性面板',
        description: '选中节点显示属性配置',
        critical: true,
        steps: [
          '创建算子节点',
          '点击节点选中',
          '验证右侧属性面板显示节点信息',
          '验证可编辑节点名称',
          '验证可配置流程输入/输出绑定',
        ],
      },
      {
        name: '工具栏操作',
        description: '工具栏按钮功能正常',
        critical: true,
        steps: [
          '验证可输入流程名称',
          '验证新建按钮清空画布',
          '验证保存按钮保存流程到服务器',
          '验证验证按钮检查流程定义',
          '验证运行按钮打开执行对话框',
        ],
      },
      {
        name: '流程保存',
        description: '流程可保存到服务器',
        critical: true,
        steps: [
          '创建流程（添加节点和连线）',
          '输入流程名称',
          '点击保存按钮',
          '验证保存成功提示',
          '验证流程列表显示已保存流程',
        ],
      },
      {
        name: '流程加载',
        description: '可从服务器加载已保存流程',
        critical: true,
        steps: [
          '点击打开按钮',
          '验证流程列表对话框显示',
          '选择一个流程',
          '验证画布加载流程内容',
          '验证节点和连线正确恢复',
        ],
      },
      {
        name: '流程执行',
        description: '流程可执行并返回结果',
        critical: true,
        steps: [
          '创建并保存一个完整流程',
          '配置流程输入/输出',
          '点击运行按钮',
          '在对话框中输入参数',
          '点击执行',
          '验证执行结果显示',
        ],
      },
      {
        name: '流程导出',
        description: '流程可导出为 JSON 配置',
        critical: false,
        steps: [
          '保存一个流程',
          '点击导出按钮',
          '验证下载 JSON 文件',
          '验证文件内容包含流程定义',
        ],
      },
      {
        name: '模板功能',
        description: '可从预设模板创建新流程',
        critical: false,
        steps: [
          '点击工具栏"模板"按钮',
          '验证模板选择对话框显示',
          '选择一个模板',
          '输入新流程名称',
          '点击创建',
          '验证画布加载模板内容',
        ],
      },
      {
        name: '版本历史',
        description: '可查看和回滚流程版本',
        critical: false,
        steps: [
          '保存一个流程多次',
          '点击工具栏"版本"按钮',
          '验证版本历史面板显示',
          '查看历史版本列表',
          '选择一个历史版本并回滚',
          '验证画布恢复到该版本',
        ],
      },
      {
        name: '分类配置',
        description: '可自定义算子分类',
        critical: false,
        steps: [
          '点击工具栏"分类"按钮',
          '验证分类配置对话框显示',
          '添加/编辑/删除分类',
          '验证分类配置保存成功',
          '验证算子面板显示新分类',
        ],
      },
      {
        name: '批量执行',
        description: '可一次执行多组输入参数',
        critical: false,
        steps: [
          '创建并保存一个带输入参数的流程',
          '点击工具栏"批量"按钮',
          '验证批量执行对话框显示',
          '添加多行输入数据',
          '点击批量执行',
          '验证所有结果正确显示',
        ],
      },
      {
        name: '参数历史',
        description: '执行时可使用历史参数',
        critical: false,
        steps: [
          '执行一个流程多次',
          '再次点击运行按钮',
          '点击参数历史下拉按钮',
          '验证显示历史记录列表',
          '选择一条历史记录',
          '验证输入框自动填充历史参数',
        ],
      },
      {
        name: '自定义输入名称',
        description: '可为流程输入定义唯一名称',
        critical: true,
        steps: [
          '拖放多个相同算子到画布',
          '在属性面板配置流程输入',
          '点击绑定名称进行编辑',
          '输入自定义名称',
          '验证名称唯一性校验',
          '保存并重新加载流程',
          '验证自定义名称保持正确',
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

