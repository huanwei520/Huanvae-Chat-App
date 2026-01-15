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

