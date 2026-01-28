# 偏好标注API文档

## 概述

本API用于偏好标注和模型训练，支持模型管理、回复生成、数据集管理和训练控制。

- **基础URL**: `http://localhost:8000`
- **API文档**: `http://localhost:8000/docs` (Swagger UI)
- **数据格式**: JSON

## 启动服务

```bash
# 在容器内启动
cd /workspace/scripts
python api_server.py

# 或者后台启动
nohup python api_server.py > /tmp/api_server.log 2>&1 &
```

---

## API 端点

### 1. 模型管理

#### 1.1 加载模型

**POST** `/api/model/load`

加载模型并设置生成参数。

**请求体**:
```json
{
  "enable_thinking": true,
  "show_thinking": true,
  "mode": "single",
  "num_responses": 4,
  "temperature": 0.85,
  "top_p": 0.9,
  "top_k": 50,
  "repetition_penalty": 1.15,
  "max_new_tokens": 512,
  "system_prompt": "你是离，一个14岁的萝莉魅魔..."
}
```

**参数说明**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| enable_thinking | bool | true | 是否启用角色化思考 |
| show_thinking | bool | true | 是否在响应中返回思考内容 |
| mode | string | "single" | 模式: single(单轮偏好) / multi(多轮对话) |
| num_responses | int | 4 | 每次生成的候选回复数量 (2-10) |
| temperature | float | 0.85 | 温度参数 (0.1-2.0) |
| top_p | float | 0.9 | Top-P采样 (0.1-1.0) |
| top_k | int | 50 | Top-K采样 (1-100) |
| repetition_penalty | float | 1.15 | 重复惩罚 (1.0-2.0) |
| max_new_tokens | int | 512 | 最大生成token数 (64-2048) |
| system_prompt | string | 默认角色设定 | 系统提示词 |

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/model/load \
  -H "Content-Type: application/json" \
  -d '{
    "enable_thinking": true,
    "show_thinking": true,
    "num_responses": 4,
    "temperature": 0.85
  }'
```

**响应**:
```json
{
  "status": "success",
  "message": "模型加载成功，使用adapter: /workspace/outputs/li-simpo",
  "data": {
    "adapter_path": "/workspace/outputs/li-simpo",
    "config": {...}
  }
}
```

---

#### 1.2 卸载模型

**POST** `/api/model/unload`

卸载模型并释放GPU显存。

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/model/unload
```

**响应**:
```json
{
  "status": "success",
  "message": "模型已卸载，显存已释放"
}
```

---

#### 1.3 获取模型状态

**GET** `/api/model/status`

获取模型加载状态和GPU信息。

**curl示例**:
```bash
curl http://localhost:8000/api/model/status
```

**响应**:
```json
{
  "status": "success",
  "message": "loaded",
  "data": {
    "model_loaded": true,
    "model_loading": false,
    "config": {...},
    "gpu_info": {
      "gpu_0": {
        "name": "NVIDIA GeForce RTX 5090",
        "memory_allocated_gb": 12.5,
        "memory_reserved_gb": 14.0
      }
    }
  }
}
```

---

### 2. 回复生成

#### 2.1 生成候选回复

**POST** `/api/generate`

生成多个候选回复供选择。

**请求体**:
```json
{
  "message": "你是谁？",
  "context": [
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好呀~"}
  ]
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 当前用户输入 |
| context | array | 否 | 对话上下文 (多轮模式使用) |

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"message": "你是谁？"}'
```

**响应**:
```json
{
  "responses": [
    {
      "id": 1,
      "thinking": "这个人类在试探我呢...要不要告诉他？",
      "content": "我叫离，是你的主人哦~"
    },
    {
      "id": 2,
      "thinking": "又一个想了解我的人...",
      "content": "叫我离就好，至于我是谁，你慢慢就知道了~"
    }
  ]
}
```

---

### 3. 数据集管理

#### 3.1 添加标注数据

**POST** `/api/dataset/add`

添加偏好数据或多轮对话数据。

**请求体 (单轮模式)**:
```json
{
  "mode": "single",
  "human_input": "你是谁？",
  "chosen": "我叫离，是你的主人哦~",
  "chosen_thinking": "这个人类在试探我...",
  "rejected": "我是AI助手，有什么可以帮您的？"
}
```

**请求体 (多轮模式)**:
```json
{
  "mode": "multi",
  "human_input": "那你喜欢什么？",
  "chosen": "有趣的人类呀~比如你",
  "chosen_thinking": "嘿嘿，吊着他玩",
  "context": [
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好呀~"},
    {"role": "user", "content": "你是谁？"},
    {"role": "assistant", "content": "我叫离~"}
  ]
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mode | string | 是 | "single" 或 "multi" |
| human_input | string | 是 | 用户输入 |
| chosen | string | 是 | 选中的最优回复 |
| chosen_thinking | string | 否 | 选中回复的思考内容 |
| rejected | string | single模式必填 | 被拒绝的回复 |
| rejected_thinking | string | 否 | 被拒绝回复的思考内容 |
| context | array | 否 | 对话上下文 |

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/dataset/add \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "single",
    "human_input": "你是谁？",
    "chosen": "我叫离~",
    "rejected": "我是AI助手"
  }'
```

**响应**:
```json
{
  "status": "success",
  "message": "已添加偏好数据，当前共 76 条",
  "data": {
    "total": 76,
    "file": "/workspace/data/li_preference.json"
  }
}
```

---

#### 3.2 获取数据集统计

**GET** `/api/dataset/stats`

**curl示例**:
```bash
curl http://localhost:8000/api/dataset/stats
```

**响应**:
```json
{
  "status": "success",
  "message": "数据集统计",
  "data": {
    "preference": {
      "file": "/workspace/data/li_preference.json",
      "count": 75
    },
    "roleplay": {
      "file": "/workspace/data/li_roleplay.json",
      "count": 280
    }
  }
}
```

---

#### 3.3 列出最近数据

**GET** `/api/dataset/list`

**查询参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| dataset | string | "preference" | "preference" 或 "roleplay" |
| limit | int | 10 | 返回条数 |

**curl示例**:
```bash
curl "http://localhost:8000/api/dataset/list?dataset=preference&limit=5"
```

---

### 4. 训练控制

#### 4.1 启动训练

**POST** `/api/train/start`

启动训练脚本 (train.sh)。

**注意**: 启动前需要先卸载模型以释放GPU显存。

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/train/start
```

**响应**:
```json
{
  "status": "success",
  "message": "训练已启动，请通过 WebSocket /ws/train/logs 获取实时日志"
}
```

---

#### 4.2 停止训练

**POST** `/api/train/stop`

**curl示例**:
```bash
curl -X POST http://localhost:8000/api/train/stop
```

---

#### 4.3 获取训练状态

**GET** `/api/train/status`

**curl示例**:
```bash
curl http://localhost:8000/api/train/status
```

**响应**:
```json
{
  "status": "success",
  "message": "running",
  "data": {
    "running": true,
    "log_count": 150,
    "recent_logs": [...]
  }
}
```

---

### 5. WebSocket 实时日志

**WebSocket** `/ws/train/logs`

实时接收训练日志。

**消息类型**:

1. **连接后收到历史日志**:
```json
{"type": "history", "logs": [...]}
```

2. **连接后收到当前状态**:
```json
{"type": "status", "running": true}
```

3. **实时日志**:
```json
{"type": "log", "time": "2026-01-27T12:00:00", "message": "训练进度..."}
```

4. **心跳**:
```json
{"type": "heartbeat"}
```

**JavaScript 示例**:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/train/logs');

ws.onopen = () => {
  console.log('WebSocket连接成功');
  // 发送心跳
  setInterval(() => ws.send('ping'), 25000);
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'status':
      console.log('训练状态:', data.running ? '运行中' : '空闲');
      break;
    case 'log':
      console.log(`[${data.time}] ${data.message}`);
      break;
    case 'history':
      data.logs.forEach(log => console.log(log.message));
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket错误:', error);
};
```

---

## 前端调用示例

### Python 示例

```python
import requests
import json

BASE_URL = "http://localhost:8000"

# 1. 加载模型
def load_model():
    resp = requests.post(f"{BASE_URL}/api/model/load", json={
        "enable_thinking": True,
        "show_thinking": True,
        "num_responses": 4,
        "temperature": 0.85
    })
    return resp.json()

# 2. 生成回复
def generate(message, context=[]):
    resp = requests.post(f"{BASE_URL}/api/generate", json={
        "message": message,
        "context": context
    })
    return resp.json()

# 3. 添加偏好数据
def add_preference(human_input, chosen, rejected, chosen_thinking=None):
    resp = requests.post(f"{BASE_URL}/api/dataset/add", json={
        "mode": "single",
        "human_input": human_input,
        "chosen": chosen,
        "chosen_thinking": chosen_thinking,
        "rejected": rejected
    })
    return resp.json()

# 4. 启动训练
def start_training():
    # 先卸载模型
    requests.post(f"{BASE_URL}/api/model/unload")
    # 启动训练
    resp = requests.post(f"{BASE_URL}/api/train/start")
    return resp.json()

# 使用示例
if __name__ == "__main__":
    # 加载模型
    print(load_model())
    
    # 生成回复
    result = generate("你是谁？")
    for r in result["responses"]:
        print(f"[{r['id']}] {r['content']}")
        if "thinking" in r:
            print(f"    思考: {r['thinking']}")
```

### JavaScript/Fetch 示例

```javascript
const BASE_URL = 'http://localhost:8000';

// 1. 加载模型
async function loadModel() {
  const response = await fetch(`${BASE_URL}/api/model/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enable_thinking: true,
      show_thinking: true,
      num_responses: 4,
      temperature: 0.85
    })
  });
  return response.json();
}

// 2. 生成回复
async function generate(message, context = []) {
  const response = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context })
  });
  return response.json();
}

// 3. 添加偏好数据
async function addPreference(humanInput, chosen, rejected, chosenThinking = null) {
  const response = await fetch(`${BASE_URL}/api/dataset/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'single',
      human_input: humanInput,
      chosen: chosen,
      chosen_thinking: chosenThinking,
      rejected: rejected
    })
  });
  return response.json();
}

// 4. 监听训练日志
function watchTrainingLogs(onLog) {
  const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/train/logs`);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onLog(data);
  };
  
  // 心跳
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('ping');
    }
  }, 25000);
  
  return ws;
}

// 使用示例
async function main() {
  // 加载模型
  await loadModel();
  
  // 生成回复
  const result = await generate('你是谁？');
  result.responses.forEach(r => {
    console.log(`[${r.id}] ${r.content}`);
    if (r.thinking) {
      console.log(`    思考: ${r.thinking}`);
    }
  });
}
```

### Vue.js 组件示例

```vue
<template>
  <div class="preference-annotator">
    <!-- 输入区域 -->
    <div class="input-section">
      <input v-model="userInput" placeholder="输入问题..." @keyup.enter="generate" />
      <button @click="generate" :disabled="loading">生成回复</button>
    </div>
    
    <!-- 候选回复 -->
    <div class="responses" v-if="responses.length">
      <div 
        v-for="r in responses" 
        :key="r.id" 
        class="response-card"
        :class="{ selected: selectedId === r.id }"
        @click="selectResponse(r)"
      >
        <div class="thinking" v-if="r.thinking">
          <span class="label">思考:</span> {{ r.thinking }}
        </div>
        <div class="content">{{ r.content }}</div>
      </div>
    </div>
    
    <!-- 保存按钮 -->
    <button v-if="selectedId" @click="savePreference">保存偏好数据</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      userInput: '',
      responses: [],
      selectedId: null,
      loading: false
    }
  },
  methods: {
    async generate() {
      this.loading = true;
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: this.userInput })
        });
        const data = await res.json();
        this.responses = data.responses;
        this.selectedId = null;
      } finally {
        this.loading = false;
      }
    },
    selectResponse(r) {
      this.selectedId = r.id;
    },
    async savePreference() {
      const chosen = this.responses.find(r => r.id === this.selectedId);
      const rejected = this.responses.find(r => r.id !== this.selectedId);
      
      await fetch('/api/dataset/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          human_input: this.userInput,
          chosen: chosen.content,
          chosen_thinking: chosen.thinking,
          rejected: rejected.content
        })
      });
      
      alert('保存成功！');
      this.userInput = '';
      this.responses = [];
      this.selectedId = null;
    }
  }
}
</script>
```

---

## 错误处理

所有API在出错时返回HTTP错误码和详细信息：

```json
{
  "detail": "错误描述信息"
}
```

常见错误码:

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 / 模型未加载 / 训练已在进行中 |
| 500 | 服务器内部错误 |

---

## 完整工作流示例

```bash
# 1. 检查服务状态
curl http://localhost:8000/health

# 2. 加载模型
curl -X POST http://localhost:8000/api/model/load \
  -H "Content-Type: application/json" \
  -d '{"enable_thinking": true, "show_thinking": true, "num_responses": 4}'

# 3. 生成回复
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"message": "你是谁？"}'

# 4. 添加偏好数据
curl -X POST http://localhost:8000/api/dataset/add \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "single",
    "human_input": "你是谁？",
    "chosen": "我叫离，是你的主人哦~",
    "chosen_thinking": "这个人类在试探我...",
    "rejected": "我是AI助手"
  }'

# 5. 查看数据集统计
curl http://localhost:8000/api/dataset/stats

# 6. 卸载模型（训练前必须）
curl -X POST http://localhost:8000/api/model/unload

# 7. 启动训练
curl -X POST http://localhost:8000/api/train/start

# 8. 查看训练状态
curl http://localhost:8000/api/train/status
```
