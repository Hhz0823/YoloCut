# 本地口播模型选型与 RTX 2060 / 4060 / 5060+ 分层

日期：2026-08-23

## 结论

最低兼容档的稳定模型继续选用 Hugging Face 的
[`nvidia/kokoro-82M-onnx-opt`](https://huggingface.co/nvidia/kokoro-82M-onnx-opt)，
并固定到 revision
`2c9213187a1925bd87478540b6c8cda1a49a8d52`。

硬件产品分层调整为：

| 档位 | 硬件标准 | 默认本地口播 |
| --- | --- | --- |
| 最低兼容 | RTX 2060、6 GB、compute capability 7.5+ | Kokoro 82M WebGPU；CPU 可回退 |
| 推荐 | RTX 4060 / RTX 5060，实测显存 8–9 GB | Fish Audio S2 Pro，`s2.cpp` CUDA + GGUF `Q6_K` |
| 性能 | RTX 40/50 系且实测显存至少 10 GB；产品定位为 RTX 5060+ 大显存 | Fish Audio S2 Pro，`s2.cpp` CUDA + GGUF `Q8_0` |

型号名称不代替显存检测：例如 8 GB 的 RTX 5060 仍使用 Q6_K，10 GB
以上才推荐 Q8_0。30 系显卡不自动升级到 Fish；用户可手动实验，但产品默认仍走
Kokoro 稳定档。

选择理由：

- Apache-2.0，可用于开源和商业发行。
- 82M 参数；首发运行包约 230 MB，适合桌面软件按需下载。
- ONNX，官方模型卡声明支持 Windows 10/11、NVIDIA Turing，并列出 WebGPU/DirectML 等推理方向。
- 官方测试硬件明确包含 GeForce RTX 2060，而不是根据参数量推测兼容。
- 模型资源内含 53 个音色，但首发只开放已经过当前中文 G2P 路径验证的
  8 个普通话音色。其余语言不得仅因权重中存在音色就标成“可用”。

## 模型比较

| 模型 | 许可 | 语言/特点 | 体积与运行方式 | RTX 2060 结论 | 首发决定 |
| --- | --- | --- | --- | --- | --- |
| `nvidia/kokoro-82M-onnx-opt` | Apache-2.0 | 资源含 53 音色；首发开放 8 个中文音色 | ONNX；首发运行包约 230 MB | 官方列出 Windows、Turing 和 RTX 2060 实测 | 稳定默认 |
| `fishaudio/s2-pro` + `rodrigomt/s2-pro-gguf` | Fish Audio Research License | 中文/英文/日文 Tier 1，支持自然语言行内情绪控制 | 约 4.56B；Q6_K 4.53 GB，Q8_0 5.63 GB；社区 `s2.cpp` CUDA | Q6_K 对应 8–9 GB；Q8_0 对应至少 10 GB | 4060/5060+ 实验推荐；非商业门禁 |
| `myshell-ai/MeloTTS-Chinese` | MIT | 中文和中英混读；CPU 可实时 | 权重约 208 MB；官方 Windows 路径主要是 Docker | 2060 主机可运行，但缺少同等强度的原生 Windows/6 GB GPU 证据 | 后续兼容包 |
| `myshell-ai/OpenVoiceV2` | MIT | 中英西法日韩；零样本音色克隆 | PyTorch/Python；官方主要提供 Linux 安装，Windows 指南为社区维护 | 未找到官方 RTX 2060 6 GB 验证 | 后续“音色克隆”实验包 |
| `FunAudioLLM/CosyVoice2-0.5B` | Apache-2.0 | 中英零样本和流式口播，质量较高 | HF 仓库约 4.86 GB；Conda/Python 运行栈 | 未找到官方 RTX 2060 6 GB 验证 | 不进入 2060 稳定目录 |
| `Supertone/supertonic-3` | OpenRAIL-M | 31 种语言、10 个音色；官方语言表不含中文 | 多 ONNX 图，本地运行 | 模型较小但没有官方 2060 验收记录 | 不作为中文首发默认 |

主要来源：

- [NVIDIA Kokoro 模型卡](https://huggingface.co/nvidia/kokoro-82M-onnx-opt/blob/main/README.md)
- [NVIDIA Kokoro 文件清单](https://huggingface.co/nvidia/kokoro-82M-onnx-opt/tree/main)
- [Kokoro 原始模型卡和音色列表](https://huggingface.co/hexgrad/Kokoro-82M)
- [Fish Audio S2 Pro 官方模型卡](https://huggingface.co/fishaudio/s2-pro)
- [s2.cpp 社区运行时](https://github.com/rodrigomatta/s2.cpp)
- [S2 Pro GGUF 文件](https://huggingface.co/rodrigomt/s2-pro-gguf/tree/main)
- [MeloTTS 中文模型卡](https://huggingface.co/myshell-ai/MeloTTS-Chinese)
- [OpenVoice V2 模型卡](https://huggingface.co/myshell-ai/OpenVoiceV2)
- [CosyVoice2 模型卡](https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B)
- [Supertonic 3 模型卡](https://huggingface.co/Supertone/supertonic-3)

## 首发模型固定信息

- Model ID：`nvidia/kokoro-82M-onnx-opt`
- Revision：`2c9213187a1925bd87478540b6c8cda1a49a8d52`
- License：Apache-2.0
- ONNX：`kokoro-82m-v1.0.onnx`
  - size：`202580587`
  - SHA-256：`0534faf2a4cdc715f9aa42660b69fffe79a69379af432d7d4497695e86f37d6d`
- Voices：`voices.bin`
  - size：`27678720`
  - SHA-256：`8a77c0d397026208d22211f37670b5b3b11e03f190756b25a1d24041fced82a9`
- 中文 tokenizer 来自 `onnx-community/Kokoro-82M-v1.1-zh-ONNX`，固定 revision
  `6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3`：
  - `config.json`：44 bytes，SHA-256
    `df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f`
  - `tokenizer.json`：4,944 bytes，SHA-256
    `5715a60b09d5e4b9074435d68c6ccd5675b9d48b220e109fdea3cda681e23d15`
  - `tokenizer_config.json`：113 bytes，SHA-256
    `be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20`
- 中文 G2P 固定为 Apache-2.0 的 `@uzen/kokoro-js@1.2.4`；ONNX Runtime
  固定为 `onnxruntime-node@1.27.0`。不得在运行时读取浮动 `main` 或联网补文件。

中文预置音色：

- 女声：`zf_xiaobei`、`zf_xiaoni`、`zf_xiaoxiao`、`zf_xiaoyi`
- 男声：`zm_yunjian`、`zm_yunxi`、`zm_yunxia`、`zm_yunyang`

## Fish S2 Pro 固定信息与许可边界

- 原模型：`fishaudio/s2-pro`，5B/BF16，Fish Audio Research License。
- GGUF 来源：`rodrigomt/s2-pro-gguf`，revision
  `a7320690b5585b03b20ed6484b55926f3015f48d`。
- Q6_K：
  - `s2-pro-q6_k.gguf`，4,525,266,528 bytes
  - SHA-256：`84ac904172a2cadb84e8f7f14ea3f1acef0584987635e85f7207fd254eafa235`
- Q8_0：
  - `s2-pro-q8_0.gguf`，5,630,037,088 bytes
  - SHA-256：`e2043182234786e7b975547d3bbcb23ff02e4ff684b82f7fa851287e4cb4f267`
- Tokenizer：12,217,872 bytes，SHA-256
  `f24e08099d45a8adf3f52f5f0b03276e433bb9d689bb15fcbcc48ce58744588b`。
- `s2.cpp` 固定 revision：`2c33261938da1a41d713768b1b391b4d368d7d2c`。
- 权重和 `s2.cpp` 衍生运行时只允许免费研究/非商业使用；商业使用必须取得
  Fish Audio 的单独书面许可。它们不是 AGPL/Apache/MIT 组件，标准 AGPL 发布物
  不内置权重或运行二进制。
- `s2.cpp` 上游明确标为 community alpha / not production-ready，当前无 Release
  二进制。因此产品必须使用独立的、带 revision/SHA/许可证确认清单的运行组件，
  权重和运行组件缺一不可。
- 首个实验目录只暴露 `random-zh`，音色每次可能不同。音色克隆和 `.s2voice`
  需要另行实现声音授权、引用音频转写和删除流程，当前不得冒充稳定音色功能。

## 产品和运行契约

1. 模型只在用户点击安装后下载。安装采用 staging、大小和 SHA-256 校验、
   原子替换；损坏文件不得进入可选列表。
2. 推理时完全离线，禁止模型运行过程回连 Hugging Face 或其他云端。
3. Windows 自动模式优先 WebGPU，并保留 CPU 回退。当前实测中，通用 Kokoro
   FP16/FP32 以及 NVIDIA 优化模型在 DirectML 的 `ConvTranspose` 均执行失败；
   Windows Node 预编译包也不提供 CUDA EP，因此首发不得展示 DirectML/CUDA。
   响应和审计记录必须报告实际 `webgpu` 或 `cpu` backend，不能把 CPU 回退显示成 GPU。
4. Fish S2 只接受 `auto`/`cuda`，实际审计写 `cuda-hybrid`：当前 CUDA 路径始终
   把部分 embedding 留在 CPU，codec 也可能选择 CPU。不得把它写成“全 GPU”。
5. RTX 2060 基线定义为 Turing、6 GB VRAM、Windows 10/11。不得要求 BF16、
   FP8 或仅在更新架构存在的指令。
6. 一次只运行一个本地 TTS 作业；限制文本长度并按自然句切分。Kokoro 建议
   每段 100–200 tokens，极短句应合并，超长句应拆分，避免短句不稳和长句抢速。
7. 输出统一为 WAV，进入媒体池；Agent 只有在用户明确要求时才通过可审核、
   可撤销的编辑提案把口播放到时间线。
8. 音色克隆不属于首发稳定范围。Fish S2/OpenVoiceV2 均必须增加声音授权和
   冒用风险提示，不能因为模型可下载就默认开放克隆。

## 验收门槛

- 目录、下载、校验、取消、删除和中断恢复测试通过。
- `provider: local` 在模型未安装、音色不存在、模型损坏时全部 fail closed。
- 真实生成至少覆盖中文、中英混读和英文，输出可由 ffprobe 读取且非静音。
- 记录冷启动时间、峰值 RAM、峰值 VRAM、实时系数和实际执行 backend。
- 2026-08-23 开发机实测：5.075 秒中文样本通过 WebGPU 生成；ORT profile
  记录 `WebGpuExecutionProvider=2186`、`CPUExecutionProvider=214` 个节点，证明不是
  静默 CPU 回退。动态长度 WebGPU session 首次推理约 1.63 秒，后续连续 14 次为
  0.187–0.205 秒（热机 RTF 约 0.04）；CPU 连续 5 次为 0.756–0.811 秒。
  因此运行时应复用 session，不能用每次冷启动结果判断 GPU 是否有效。
- 同一依赖组合已在项目的 Electron 43 Node 运行时再次生成成功；输出为
  24 kHz、单声道、5.075 秒 PCM WAV，平均音量 -21.0 dB、峰值 -4.4 dB。
- 通过正式 worker 和 HTTP API 的端到端验收覆盖了女声、男声、WebGPU 与显式 CPU：
  WebGPU 冷启动约 7.95 秒，热机约 1.28 秒；显式 CPU 约 9.36 秒。三条 HTTP
  产物均可通过同源媒体 URL 读取，均为 24 kHz 单声道 PCM WAV，且归一化后
  `clippedSamples=0`。Windows TEMP 的 8.3 短路径与长路径差异、反斜杠媒体 URL
  也已加入回归测试。
- 本次端到端开发机为 RTX 5070 12 GB；上述数据用于证明产品路径和实际 backend
  审计有效，不冒充 RTX 2060 实机成绩。
- 2026-08-23 在同一 RTX 5070 12 GB 机器上，`s2.cpp` revision
  `2c332619...` 使用 VS2022、CUDA 13.1、Ninja 和 ASCII 映射路径完成 Windows
  CUDA 全量构建；`s2.exe --help` 自检成功。生成的独立运行组件清单覆盖
  `s2.exe`、四个 ggml DLL 与许可证，并逐文件校验 SHA-256。
- 该 CUDA 二进制依赖 `cublas64_13.dll` / `cublasLt64_13.dll`。当前产品运行门禁
  会执行已校验二进制自检；缺少 CUDA 13.1 cublas 或 VC++ 运行库时，Fish 模型
  即使权重已经下载也保持不可选。
- 尚未下载 4.53/5.63 GB GGUF，也未完成 Fish S2 真实合成。因此现在只能称为
  “运行组件构建和接口通过”，不能称为 Q6_K/Q8_0 音质、速度或稳定性已验收。
- RTX 2060 实机完成同一套样本后，才可在产品中显示“RTX 2060 已验收”；
  在其他显卡上的通过结果只能写“目标兼容”，不能代替 2060 实测。
