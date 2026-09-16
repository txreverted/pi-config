import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const ORBIO_MODELS: ProviderModelConfig[] = [
  {
    "id": "deepseek/deepseek-v4.1-flash",
    "name": "DeepSeek: DeepSeek V4.1 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 384000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.003,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "inception/mercury-2.5",
    "name": "Inception: Mercury 2.5",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 260000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.04,
      "output": 0.15,
      "cacheRead": 0.004,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nex-agi/nex-n2.5-mini:free",
    "name": "Nex AGI: Nex-N2.5-Mini (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nex-agi/nex-n2.5-pro:free",
    "name": "Nex AGI: Nex-N2.5-Pro (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-6-astra",
    "name": "OpenAI: GPT-6 Astra",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 1.0,
      "cacheWrite": 12.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 20.0,
          "output": 75.0,
          "cacheRead": 2.0,
          "cacheWrite": 25.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-6-astra:batch",
    "name": "OpenAI: GPT-6 Astra (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 10.0,
          "output": 37.5,
          "cacheRead": 1.0,
          "cacheWrite": 12.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-6-astra-pro",
    "name": "OpenAI: GPT-6 Astra Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 1.0,
      "cacheWrite": 12.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 20.0,
          "output": 75.0,
          "cacheRead": 2.0,
          "cacheWrite": 25.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-6-astra-pro:batch",
    "name": "OpenAI: GPT-6 Astra Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 10.0,
          "output": 37.5,
          "cacheRead": 1.0,
          "cacheWrite": 12.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "inclusionai/ling-3.0-flash-sante:free",
    "name": "inclusionAI: Ling 3.0 Flash Sante (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.8-max-0902",
    "name": "Qwen: Qwen3.8 Max (0902)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.25,
      "cacheWrite": 2.5
    }
  },
  {
    "id": "meta/muse-spark-1.3-contributor",
    "name": "Meta: Muse Spark 1.3 Contributor",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.1,
      "output": 0.2,
      "cacheRead": 0.002,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-spark-1.3",
    "name": "Meta: Muse Spark 1.3",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.25,
      "output": 4.25,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.8-flash",
    "name": "Google: Gemini 3.8 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 3.75,
      "cacheRead": 0.075,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "google/gemini-3.8-flash:batch",
    "name": "Google: Gemini 3.8 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.375,
      "output": 1.875,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "anthropic/claude-fable-5.1",
    "name": "Anthropic: Claude Fable 5.1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 0.25,
      "cacheWrite": 12.5
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-fable-5.1:batch",
    "name": "Anthropic: Claude Fable 5.1 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.125,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "ibm-granite/granite-4.2-8b",
    "name": "IBM: Granite 4.2 8B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.06,
      "output": 0.25,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy4-preview",
    "name": "Tencent: Hy4 preview",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.834,
      "output": 2.501,
      "cacheRead": 0.042,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "inclusionai/ling-3.0-flash-fin",
    "name": "inclusionAI: Ling 3.0 Flash Fin",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.06,
      "output": 0.18,
      "cacheRead": 0.012,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "inclusionai/ling-3.0-flash-fin:free",
    "name": "inclusionAI: Ling 3.0 Flash Fin (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~z-ai/glm-flash-latest",
    "name": "Z.ai: GLM Flash Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1310720,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.075,
      "output": 0.25,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.8-flash",
    "name": "Qwen: Qwen3.8 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.15,
      "output": 0.47,
      "cacheRead": 0.016,
      "cacheWrite": 0.2
    }
  },
  {
    "id": "z-ai/glm-5.3-flash",
    "name": "Z.ai: GLM 5.3 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1310720,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.15,
      "output": 0.5,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5.3-flash:batch",
    "name": "Z.ai: GLM 5.3 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.075,
      "output": 0.25,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-spark-1.2-contributor",
    "name": "Meta: Muse Spark 1.2 Contributor",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.1,
      "output": 0.2,
      "cacheRead": 0.002,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-flash-vision-exp",
    "name": "DeepSeek: DeepSeek V4 Flash Vision Exp",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.22,
      "output": 0.66,
      "cacheRead": 0.007,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-flash-vision-exp:batch",
    "name": "DeepSeek: DeepSeek V4 Flash Vision Exp (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.11,
      "output": 0.33,
      "cacheRead": 0.0035,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy-mt2-1.8b",
    "name": "Tencent: Hy-MT2-1.8B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 4096,
    "cost": {
      "input": 0.044,
      "output": 0.177,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy-mt2-30b-a3b",
    "name": "Tencent: Hy-MT2-30B-A3B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 4096,
    "cost": {
      "input": 0.074,
      "output": 0.295,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~z-ai/glm-latest",
    "name": "Z.ai: GLM Latest",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1310720,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.0075,
      "output": 3.41,
      "cacheRead": 0.2015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy-mt2-7b",
    "name": "Tencent: Hy-MT2-7B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 4096,
    "cost": {
      "input": 0.074,
      "output": 0.295,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5.3",
    "name": "Z.ai: GLM 5.3",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1310720,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.4,
      "output": 4.4,
      "cacheRead": 0.26,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5.3:batch",
    "name": "Z.ai: GLM 5.3 (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.7,
      "output": 2.2,
      "cacheRead": 0.13,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.8-27b",
    "name": "Qwen: Qwen3.8 27B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": null,
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.42,
      "output": 3.0,
      "cacheRead": 0.085,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "dots-studio/dots-3-note-preview:free",
    "name": "Dots Studio: Dots3-Note Preview (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 512000,
    "maxTokens": 460800,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.7-flash",
    "name": "Google: Gemini 3.7 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 3.75,
      "cacheRead": 0.075,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "google/gemini-3.7-flash:batch",
    "name": "Google: Gemini 3.7 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.375,
      "output": 1.875,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "bytedance-seed/seed-2-1-turbo",
    "name": "ByteDance Seed: Seed 2.1 Turbo",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.5,
      "output": 2.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.8-2.4t-a95b",
    "name": "Qwen: Qwen3.8 2.4T A95B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": null,
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.8-2.4t-a95b:batch",
    "name": "Qwen: Qwen3.8 2.4T A95B (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1010000,
    "maxTokens": 909000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": null,
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "bytedance-seed/seed-2.0-code",
    "name": "ByteDance Seed: Seed-2.0-Code",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.5,
      "output": 3.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 1.0,
          "output": 6.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "deepseek/deepseek-v4-pro-0813",
    "name": "DeepSeek: DeepSeek V4 Pro 0813",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 384000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.0494,
      "output": 3.1482,
      "cacheRead": 0.03498,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-pro-0813:batch",
    "name": "DeepSeek: DeepSeek V4 Pro 0813 (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.66,
      "output": 1.98,
      "cacheRead": 0.022,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "x-ai/grok-4.6",
    "name": "SpaceXAI: Grok 4.6",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 500000,
    "maxTokens": 450000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 12.0,
          "cacheRead": 1.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "liquid/lfm-2.5-2.6b:free",
    "name": "LiquidAI: LFM2.5-2.6B (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 65536,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3.5-lightning",
    "name": "NVIDIA: Nemotron 3.5 Lightning",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.08,
      "output": 0.2,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3.5-lightning:free",
    "name": "NVIDIA: Nemotron 3.5 Lightning (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sakana/sakana-namazu",
    "name": "Sakana: Sakana Namazu",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.95,
      "output": 4.0,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "upstage/solar-pro4",
    "name": "Upstage: Solar Pro 4",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 524288,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.03,
      "output": 0.12,
      "cacheRead": 0.006,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-glimmer-30b",
    "name": "Meta: Muse Glimmer 30B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.3,
      "output": 1.1,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-glimmer-30b:batch",
    "name": "Meta: Muse Glimmer 30B (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.175,
      "output": 0.75,
      "cacheRead": 0.02,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-spark-1.2",
    "name": "Meta: Muse Spark 1.2",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 4.25,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~deepseek/deepseek-v4-flash-latest",
    "name": "DeepSeek V4 Flash Latest",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1310720,
    "maxTokens": 393216,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.05,
      "output": 0.16,
      "cacheRead": 0.013,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-flash-0731",
    "name": "DeepSeek: DeepSeek V4 Flash 0731",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1310720,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.065,
      "output": 0.18,
      "cacheRead": 0.016,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-flash-0731:batch",
    "name": "DeepSeek: DeepSeek V4 Flash 0731 (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.11,
      "output": 0.33,
      "cacheRead": 0.0035,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling-small",
    "name": "Thinking Machines: Inkling Small",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 262144,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.45,
      "output": 1.2,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling-small:batch",
    "name": "Thinking Machines: Inkling Small (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 524288,
    "maxTokens": 471859,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.5,
      "output": 1.2,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling-small:free",
    "name": "Thinking Machines: Inkling Small (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 262144,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.7-flash",
    "name": "Qwen: Qwen3.7 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.03,
      "output": 0.13,
      "cacheRead": 0.006,
      "cacheWrite": 0.038,
      "tiers": [
        {
          "inputTokensAbove": 32000,
          "input": 0.1,
          "output": 0.4,
          "cacheRead": 0.02,
          "cacheWrite": 0.125
        },
        {
          "inputTokensAbove": 256000,
          "input": 0.2,
          "output": 0.8,
          "cacheRead": 0.04,
          "cacheWrite": 0.25
        }
      ]
    }
  },
  {
    "id": "anthropic/claude-opus-5",
    "name": "Claude Opus 5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-5:batch",
    "name": "Claude Opus 5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.25,
      "cacheWrite": 3.125
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "inclusionai/ling-3.0-flash",
    "name": "inclusionAI: Ling 3.0 Flash",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.021,
      "output": 0.063,
      "cacheRead": 0.0042,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "poolside/laguna-s-2.1",
    "name": "Poolside: Laguna S 2.1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.09,
      "output": 0.18,
      "cacheRead": 0.009,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "poolside/laguna-s-2.1:free",
    "name": "Poolside: Laguna S 2.1 (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.6-flash",
    "name": "Google: Gemini 3.6 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 3.75,
      "cacheRead": 0.075,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "google/gemini-3.6-flash:batch",
    "name": "Google: Gemini 3.6 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.375,
      "output": 1.875,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "google/gemini-3.5-flash-lite",
    "name": "Google: Gemini 3.5 Flash Lite",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.3,
      "output": 2.5,
      "cacheRead": 0.03,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-3.5-flash-lite:batch",
    "name": "Google: Gemini 3.5 Flash Lite (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.15,
      "output": 1.25,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meituan/longcat-2.0",
    "name": "Meituan: LongCat 2.0",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048756,
    "maxTokens": 262144,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.006,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling",
    "name": "Thinking Machines: Inkling",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 4.05,
      "cacheRead": 0.17,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling:batch",
    "name": "Thinking Machines: Inkling (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 524288,
    "maxTokens": 471859,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 4.05,
      "cacheRead": 0.17,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thinkingmachines/inkling:free",
    "name": "Thinking Machines: Inkling (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 262144,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openrouter/auto-beta",
    "name": "Auto Router (Beta)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 2000000,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k3",
    "name": "MoonshotAI: Kimi K3",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.3,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k3:batch",
    "name": "MoonshotAI: Kimi K3 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.3,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta/muse-spark-1.1",
    "name": "Meta: Muse Spark 1.1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 4.25,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2.5",
    "name": "Kwaipilot: KAT-Coder-Pro V2.5",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "cost": {
      "input": 0.74,
      "output": 2.96,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.6-luna-pro",
    "name": "OpenAI: GPT-5.6 Luna Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.2,
      "output": 1.2,
      "cacheRead": 0.02,
      "cacheWrite": 0.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 0.4,
          "output": 1.8,
          "cacheRead": 0.04,
          "cacheWrite": 0.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-luna-pro:batch",
    "name": "OpenAI: GPT-5.6 Luna Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.1,
      "output": 0.6,
      "cacheRead": 0.01,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 0.2,
          "output": 0.9,
          "cacheRead": 0.02,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-luna",
    "name": "OpenAI: GPT-5.6 Luna",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.2,
      "output": 1.2,
      "cacheRead": 0.02,
      "cacheWrite": 0.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 0.4,
          "output": 1.8,
          "cacheRead": 0.04,
          "cacheWrite": 0.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-luna:batch",
    "name": "OpenAI: GPT-5.6 Luna (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.1,
      "output": 0.6,
      "cacheRead": 0.01,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 0.2,
          "output": 0.9,
          "cacheRead": 0.02,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-terra-pro",
    "name": "OpenAI: GPT-5.6 Terra Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-terra-pro:batch",
    "name": "OpenAI: GPT-5.6 Terra Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 6.0,
      "cacheRead": 0.1,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 2.0,
          "output": 9.0,
          "cacheRead": 0.2,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-terra",
    "name": "OpenAI: GPT-5.6 Terra",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-terra:batch",
    "name": "OpenAI: GPT-5.6 Terra (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 6.0,
      "cacheRead": 0.1,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 2.0,
          "output": 9.0,
          "cacheRead": 0.2,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-sol-pro",
    "name": "OpenAI: GPT-5.6 Sol Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 15.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-sol-pro:batch",
    "name": "OpenAI: GPT-5.6 Sol Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 5.0,
      "cacheRead": 0.1,
      "cacheWrite": 1.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 2.0,
          "output": 7.5,
          "cacheRead": 0.2,
          "cacheWrite": 2.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-sol",
    "name": "OpenAI: GPT-5.6 Sol",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 15.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.6-sol:batch",
    "name": "OpenAI: GPT-5.6 Sol (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 5.0,
      "cacheRead": 0.1,
      "cacheWrite": 1.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 2.0,
          "output": 7.5,
          "cacheRead": 0.2,
          "cacheWrite": 2.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "x-ai/grok-4.5",
    "name": "SpaceXAI: Grok 4.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 500000,
    "maxTokens": 450000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.3,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 12.0,
          "cacheRead": 0.6,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "~x-ai/grok-latest",
    "name": "xAI: Grok Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 500000,
    "maxTokens": 450000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 12.0,
          "cacheRead": 1.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "aion-labs/aion-3.0-mini",
    "name": "AionLabs: Aion-3.0-Mini",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.7,
      "output": 1.4,
      "cacheRead": 0.18,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "aion-labs/aion-3.0",
    "name": "AionLabs: Aion-3.0",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 3.0,
      "output": 6.0,
      "cacheRead": 0.75,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy3",
    "name": "Tencent: Hy3",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.132,
      "output": 0.528,
      "cacheRead": 0.033,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "poolside/laguna-xs-2.1",
    "name": "Poolside: Laguna XS 2.1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.06,
      "output": 0.12,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "poolside/laguna-xs-2.1:free",
    "name": "Poolside: Laguna XS 2.1 (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-sonnet-5",
    "name": "Anthropic: Claude Sonnet 5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-sonnet-5:batch",
    "name": "Anthropic: Claude Sonnet 5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 1.0,
      "output": 5.0,
      "cacheRead": 0.1,
      "cacheWrite": 1.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "google/gemini-3.1-flash-lite-image",
    "name": "Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 65536,
    "maxTokens": 58982,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 1.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sakana/fugu-ultra",
    "name": "Sakana: Fugu Ultra",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 30.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 10.0,
          "output": 45.0,
          "cacheRead": 1.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "google/gemini-3.1-flash-image",
    "name": "Google: Nano Banana 2 (Gemini 3.1 Flash Image)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.5,
      "output": 3.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3-pro-image",
    "name": "Google: Nano Banana Pro (Gemini 3 Pro Image)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.375
    }
  },
  {
    "id": "cohere/north-mini-code:free",
    "name": "Cohere: North Mini Code (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5.2",
    "name": "Z.ai: GLM 5.2",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 163840,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.4875,
      "output": 1.56,
      "cacheRead": 0.091,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5.2:batch",
    "name": "Z.ai: GLM 5.2 (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.7,
      "output": 2.2,
      "cacheRead": 0.07,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openrouter/fusion",
    "name": "OpenRouter: Fusion",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "name": "MoonshotAI: Kimi K2.7 Code",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.71,
      "output": 3.5,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~anthropic/claude-fable-latest",
    "name": "Anthropic: Claude Fable Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 0.25,
      "cacheWrite": 12.5
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-fable-5",
    "name": "Anthropic: Claude Fable 5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 1.0,
      "cacheWrite": 12.5
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-fable-5:batch",
    "name": "Anthropic: Claude Fable 5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "nvidia/nemotron-3.5-content-safety",
    "name": "NVIDIA: Nemotron 3.5 Content Safety",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.2,
      "output": 0.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3.5-content-safety:free",
    "name": "NVIDIA: Nemotron 3.5 Content Safety (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "NVIDIA: Nemotron 3 Ultra",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.625,
      "output": 3.125,
      "cacheRead": 0.1875,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "name": "NVIDIA: Nemotron 3 Ultra (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.7-plus",
    "name": "Qwen: Qwen3.7 Plus",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.32,
      "output": 1.28,
      "cacheRead": 0.064,
      "cacheWrite": 0.4,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.96,
          "output": 3.84,
          "cacheRead": 0.192,
          "cacheWrite": 1.2
        }
      ]
    }
  },
  {
    "id": "minimax/minimax-m3",
    "name": "MiniMax: MiniMax M3",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 512000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-m3:batch",
    "name": "MiniMax: MiniMax M3 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 524288,
    "maxTokens": 471859,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "stepfun/step-3.7-flash",
    "name": "StepFun: Step 3.7 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 230400,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.2,
      "output": 1.15,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-opus-4.8",
    "name": "Anthropic: Claude Opus 4.8",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-4.8:batch",
    "name": "Anthropic: Claude Opus 4.8 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.25,
      "cacheWrite": 3.125
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "qwen/qwen3.7-max",
    "name": "Qwen: Qwen3.7 Max",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.475,
      "output": 4.425,
      "cacheRead": 0.295,
      "cacheWrite": 1.84375
    }
  },
  {
    "id": "x-ai/grok-build-0.1",
    "name": "SpaceXAI: Grok Build 0.1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 256000,
    "maxTokens": 230400,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 1.0,
      "output": 2.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.0,
          "output": 4.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "google/gemini-3.5-flash",
    "name": "Google: Gemini 3.5 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.5,
      "output": 9.0,
      "cacheRead": 0.15,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-3.5-flash:batch",
    "name": "Google: Gemini 3.5 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 4.5,
      "cacheRead": 0.075,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perceptron/perceptron-mk1",
    "name": "Perceptron: Perceptron Mk1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 32768,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.15,
      "output": 1.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "name": "Google: Gemini 3.1 Flash Lite",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 1.5,
      "cacheRead": 0.025,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-3.1-flash-lite:batch",
    "name": "Google: Gemini 3.1 Flash Lite (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.125,
      "output": 0.75,
      "cacheRead": 0.0125,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-chat-latest",
    "name": "OpenAI: GPT Chat Latest",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "cost": {
      "input": 5.0,
      "output": 30.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "x-ai/grok-4.3",
    "name": "SpaceXAI: Grok 4.3",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 900000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 2.5,
      "cacheRead": 0.2,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 5.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "x-ai/grok-4.3:batch",
    "name": "SpaceXAI: Grok 4.3 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 900000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.0,
      "output": 2.0,
      "cacheRead": 0.16,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.0,
          "output": 4.0,
          "cacheRead": 0.32,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "mistralai/mistral-medium-3-5",
    "name": "Mistral: Mistral Medium 3.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.5,
      "output": 7.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-medium-3-5:batch",
    "name": "Mistral: Mistral Medium 3.5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 3.75,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "name": "NVIDIA: Nemotron 3 Nano Omni (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 256000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~anthropic/claude-haiku-latest",
    "name": "Anthropic Claude Haiku Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.0,
      "output": 5.0,
      "cacheRead": 0.1,
      "cacheWrite": 1.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "~openai/gpt-mini-latest",
    "name": "OpenAI GPT Mini Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 4.5,
      "cacheRead": 0.075,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "~google/gemini-pro-latest",
    "name": "Google Gemini Pro Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "~moonshotai/kimi-latest",
    "name": "MoonshotAI Kimi Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 943718,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 2.4,
      "output": 12.0,
      "cacheRead": 0.24,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~google/gemini-flash-latest",
    "name": "Google Gemini Flash Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 3.75,
      "cacheRead": 0.075,
      "cacheWrite": 0.0416666666666667
    }
  },
  {
    "id": "~anthropic/claude-sonnet-latest",
    "name": "Anthropic Claude Sonnet Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "~openai/gpt-latest",
    "name": "OpenAI GPT Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 15.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "qwen/qwen3.5-plus-20260420",
    "name": "Qwen: Qwen3.5 Plus 2026-04-20",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 1.8,
      "cacheRead": 0.0,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.375,
          "output": 2.25,
          "cacheRead": 0.0,
          "cacheWrite": 0.46875
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3.6-flash",
    "name": "Qwen: Qwen3.6 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.1875,
      "output": 1.125,
      "cacheRead": 0.0,
      "cacheWrite": 0.234375,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.75,
          "output": 3.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.9375
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3.6-35b-a3b",
    "name": "Qwen: Qwen3.6 35B A3B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.1,
      "output": 0.9,
      "cacheRead": 0.05,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.6-max-preview",
    "name": "Qwen: Qwen3.6 Max Preview",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.027,
      "output": 6.162,
      "cacheRead": 0.0,
      "cacheWrite": 1.28375,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 1.58,
          "output": 9.48,
          "cacheRead": 0.0,
          "cacheWrite": 1.975
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3.6-27b",
    "name": "Qwen: Qwen3.6 27B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 2.0,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.5-pro",
    "name": "OpenAI: GPT-5.5 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 30.0,
      "output": 180.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 60.0,
          "output": 270.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.5-pro:batch",
    "name": "OpenAI: GPT-5.5 Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 15.0,
      "output": 90.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 30.0,
          "output": 135.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.5",
    "name": "OpenAI: GPT-5.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 5.0,
      "output": 30.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 10.0,
          "output": 45.0,
          "cacheRead": 1.0,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.5:batch",
    "name": "OpenAI: GPT-5.5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.5,
      "output": 15.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 5.0,
          "output": 22.5,
          "cacheRead": 0.5,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "name": "DeepSeek: DeepSeek V4 Pro 0423",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 384000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.95526,
      "output": 1.91052,
      "cacheRead": 0.079605,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "name": "DeepSeek: DeepSeek V4 Flash 0423",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 384000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.088606,
      "output": 0.177212,
      "cacheRead": 0.0177212,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hy3-preview",
    "name": "Tencent: Hy3 preview",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.18,
      "output": 0.6,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "xiaomi/mimo-v2.5-pro",
    "name": "Xiaomi: MiMo-V2.5-Pro",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1050000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.435,
      "output": 0.87,
      "cacheRead": 0.0036,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "xiaomi/mimo-v2.5",
    "name": "Xiaomi: MiMo-V2.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.14,
      "output": 0.28,
      "cacheRead": 0.0028,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.4-image-2",
    "name": "OpenAI: GPT-5.4 Image 2",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 272000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 8.0,
      "output": 15.0,
      "cacheRead": 2.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "~anthropic/claude-opus-latest",
    "name": "Anthropic: Claude Opus Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "openrouter/pareto-code",
    "name": "Pareto Code Router",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 2000000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "name": "MoonshotAI: Kimi K2.6",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.95,
      "output": 4.0,
      "cacheRead": 0.16,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-opus-4.7",
    "name": "Anthropic: Claude Opus 4.7",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-4.7:batch",
    "name": "Anthropic: Claude Opus 4.7 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.25,
      "cacheWrite": 3.125
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "z-ai/glm-5.1",
    "name": "Z.ai: GLM 5.1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.966,
      "output": 3.036,
      "cacheRead": 0.1794,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "name": "Google: Gemma 4 26B A4B ",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.07,
      "output": 0.34,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-4-26b-a4b-it:free",
    "name": "Google: Gemma 4 26B A4B  (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-4-31b-it",
    "name": "Google: Gemma 4 31B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.09,
      "output": 0.34,
      "cacheRead": 0.05,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-4-31b-it:batch",
    "name": "Google: Gemma 4 31B (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.39,
      "output": 0.97,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-4-31b-it:free",
    "name": "Google: Gemma 4 31B (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.6-plus",
    "name": "Qwen: Qwen3.6 Plus",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.325,
      "output": 1.95,
      "cacheRead": 0.0,
      "cacheWrite": 0.40625,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 1.3,
          "output": 3.9,
          "cacheRead": 0.0,
          "cacheWrite": 1.625
        }
      ]
    }
  },
  {
    "id": "z-ai/glm-5v-turbo",
    "name": "Z.ai: GLM 5V Turbo",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 202752,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.2,
      "output": 4.0,
      "cacheRead": 0.24,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "arcee-ai/trinity-large-thinking",
    "name": "Arcee AI: Trinity Large Thinking",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 80000,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.25,
      "output": 0.8,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "x-ai/grok-4.20-multi-agent",
    "name": "SpaceXAI: Grok 4.20 Multi-Agent",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 2000000,
    "maxTokens": 1800000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 2.5,
      "cacheRead": 0.2,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 5.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "x-ai/grok-4.20",
    "name": "SpaceXAI: Grok 4.20",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 2000000,
    "maxTokens": 1800000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.25,
      "output": 2.5,
      "cacheRead": 0.2,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 5.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "google/lyria-3-pro-preview",
    "name": "Google: Lyria 3 Pro Preview",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/lyria-3-clip-preview",
    "name": "Google: Lyria 3 Clip Preview",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "kwaipilot/kat-coder-pro-v2",
    "name": "Kwaipilot: KAT-Coder-Pro V2",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 144000,
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "rekaai/reka-edge",
    "name": "Reka Edge",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 16384,
    "maxTokens": 14745,
    "cost": {
      "input": 0.1,
      "output": 0.1,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-m2.7",
    "name": "MiniMax: MiniMax M2.7",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.06,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.4-nano",
    "name": "OpenAI: GPT-5.4 Nano",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.2,
      "output": 1.25,
      "cacheRead": 0.02,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4-nano:batch",
    "name": "OpenAI: GPT-5.4 Nano (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.1,
      "output": 0.625,
      "cacheRead": 0.01,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4-mini",
    "name": "OpenAI: GPT-5.4 Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.75,
      "output": 4.5,
      "cacheRead": 0.075,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4-mini:batch",
    "name": "OpenAI: GPT-5.4 Mini (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.375,
      "output": 2.25,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/mistral-small-2603",
    "name": "Mistral: Mistral Small 4",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-small-2603:batch",
    "name": "Mistral: Mistral Small 4 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.075,
      "output": 0.3,
      "cacheRead": 0.0075,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5-turbo",
    "name": "Z.ai: GLM 5 Turbo",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 202752,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.2,
      "output": 4.0,
      "cacheRead": 0.24,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "name": "NVIDIA: Nemotron 3 Super",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": null,
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.085,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b:free",
    "name": "NVIDIA: Nemotron 3 Super (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": null,
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "bytedance-seed/seed-2.0-lite",
    "name": "ByteDance Seed: Seed-2.0-Lite",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 2.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 0.5,
          "output": 4.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3.5-9b",
    "name": "Qwen: Qwen3.5-9B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.1,
      "output": 0.15,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.5-9b:batch",
    "name": "Qwen: Qwen3.5-9B (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.17,
      "output": 0.25,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.4-pro",
    "name": "OpenAI: GPT-5.4 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 30.0,
      "output": 180.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 60.0,
          "output": 270.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4-pro:batch",
    "name": "OpenAI: GPT-5.4 Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 15.0,
      "output": 90.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 30.0,
          "output": 135.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4",
    "name": "OpenAI: GPT-5.4",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 2.5,
      "output": 15.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 5.0,
          "output": 22.5,
          "cacheRead": 0.5,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.4:batch",
    "name": "OpenAI: GPT-5.4 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 7.5,
      "cacheRead": 0.125,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 2.5,
          "output": 11.25,
          "cacheRead": 0.25,
          "cacheWrite": 0.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "inception/mercury-2",
    "name": "Inception: Mercury 2",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 50000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 0.75,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "name": "Google: Gemini 3.1 Flash Lite Preview",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 1.5,
      "cacheRead": 0.025,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "bytedance-seed/seed-2.0-mini",
    "name": "ByteDance Seed: Seed-2.0-Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.1,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 0.2,
          "output": 0.8,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "google/gemini-3.1-flash-image-preview",
    "name": "Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 65536,
    "maxTokens": 58982,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.5,
      "output": 3.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.5-35b-a3b",
    "name": "Qwen: Qwen3.5-35B-A3B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3125,
      "output": 1.25,
      "cacheRead": 0.15625,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.5-27b",
    "name": "Qwen: Qwen3.5-27B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.195,
      "output": 1.56,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.5-122b-a10b",
    "name": "Qwen: Qwen3.5-122B-A10B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.26,
      "output": 2.08,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3.5-flash-02-23",
    "name": "Qwen: Qwen3.5-Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.065,
      "output": 0.26,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.1-pro-preview-customtools",
    "name": "Google: Gemini 3.1 Pro Preview Custom Tools",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "openai/gpt-5.3-codex",
    "name": "OpenAI: GPT-5.3-Codex",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.75,
      "output": 14.0,
      "cacheRead": 0.175,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "aion-labs/aion-2.0",
    "name": "AionLabs: Aion-2.0",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.8,
      "output": 1.6,
      "cacheRead": 0.2,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3.1-pro-preview",
    "name": "Google: Gemini 3.1 Pro Preview",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "google/gemini-3.1-pro-preview:batch",
    "name": "Google: Gemini 3.1 Pro Preview (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.0,
      "output": 6.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.0,
          "output": 9.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "name": "Anthropic: Claude Sonnet 4.6",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.3,
      "cacheWrite": 3.75
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-sonnet-4.6:batch",
    "name": "Anthropic: Claude Sonnet 4.6 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 1.5,
      "output": 7.5,
      "cacheRead": 0.15,
      "cacheWrite": 1.875
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "qwen/qwen3.5-plus-02-15",
    "name": "Qwen: Qwen3.5 Plus 2026-02-15",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.26,
      "output": 1.56,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.325,
          "output": 1.95,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3.5-397b-a17b",
    "name": "Qwen: Qwen3.5 397B A17B",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.55,
      "output": 3.5,
      "cacheRead": 0.225,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-m2.5",
    "name": "MiniMax: MiniMax M2.5",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-5",
    "name": "Z.ai: GLM 5",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.6,
      "output": 1.92,
      "cacheRead": 0.12,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-max-thinking",
    "name": "Qwen: Qwen3 Max Thinking",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.78,
      "output": 3.9,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 32000,
          "input": 1.56,
          "output": 7.8,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        },
        {
          "inputTokensAbove": 128000,
          "input": 1.95,
          "output": 9.75,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "anthropic/claude-opus-4.6",
    "name": "Anthropic: Claude Opus 4.6",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-4.6:batch",
    "name": "Anthropic: Claude Opus 4.6 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.25,
      "cacheWrite": 3.125
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "qwen/qwen3-coder-next",
    "name": "Qwen: Qwen3 Coder Next",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "cost": {
      "input": 0.12,
      "output": 0.8,
      "cacheRead": 0.07,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openrouter/free",
    "name": "Free Models Router",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "stepfun/step-3.5-flash",
    "name": "StepFun: Step 3.5 Flash",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.1,
      "output": 0.3,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "name": "MoonshotAI: Kimi K2.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.45,
      "output": 2.25,
      "cacheRead": 0.07,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "upstage/solar-pro-3",
    "name": "Upstage: Solar Pro 3",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-m2-her",
    "name": "MiniMax: MiniMax M2-her",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 65536,
    "maxTokens": 2048,
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "writer/palmyra-x5",
    "name": "Writer: Palmyra X5",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1040000,
    "maxTokens": 8192,
    "cost": {
      "input": 0.6,
      "output": 6.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-audio",
    "name": "OpenAI: GPT Audio",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-audio-mini",
    "name": "OpenAI: GPT Audio Mini",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.6,
      "output": 2.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "z-ai/glm-4.7-flash",
    "name": "Z.ai: GLM 4.7 Flash",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 200000,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0605,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.2-codex",
    "name": "OpenAI: GPT-5.2-Codex",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.75,
      "output": 14.0,
      "cacheRead": 0.175,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "bytedance-seed/seed-1.6-flash",
    "name": "ByteDance Seed: Seed 1.6 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.075,
      "output": 0.3,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 0.1,
          "output": 0.8,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "bytedance-seed/seed-1.6",
    "name": "ByteDance Seed: Seed 1.6",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.25,
      "output": 2.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 128000,
          "input": 0.5,
          "output": 4.0,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "minimax/minimax-m2.1",
    "name": "MiniMax: MiniMax M2.1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.3,
      "output": 1.2,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-4.7",
    "name": "Z.ai: GLM 4.7",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.4,
      "output": 1.75,
      "cacheRead": 0.08,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-3-flash-preview",
    "name": "Google: Gemini 3 Flash Preview",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.5,
      "output": 3.0,
      "cacheRead": 0.05,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-3-flash-preview:batch",
    "name": "Google: Gemini 3 Flash Preview (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 1.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "name": "NVIDIA: Nemotron 3 Nano 30B A3B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.05,
      "output": 0.2,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.2-chat",
    "name": "OpenAI: GPT-5.2 Chat",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 32000,
    "cost": {
      "input": 1.75,
      "output": 14.0,
      "cacheRead": 0.175,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.2-pro",
    "name": "OpenAI: GPT-5.2 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 21.0,
      "output": 168.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.2-pro:batch",
    "name": "OpenAI: GPT-5.2 Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 10.5,
      "output": 84.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.2",
    "name": "OpenAI: GPT-5.2",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.75,
      "output": 14.0,
      "cacheRead": 0.175,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.2:batch",
    "name": "OpenAI: GPT-5.2 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.875,
      "output": 7.0,
      "cacheRead": 0.0875,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/devstral-2512",
    "name": "Mistral: Devstral 2 2512",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.4,
      "output": 2.0,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "relace/relace-search",
    "name": "Relace: Relace Search",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 128000,
    "cost": {
      "input": 1.0,
      "output": 3.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-4.6v",
    "name": "Z.ai: GLM 4.6V",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 0.9,
      "cacheRead": 0.055,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openrouter/bodybuilder",
    "name": "Body Builder (beta)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5.1-codex-max",
    "name": "OpenAI: GPT-5.1-Codex-Max",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "amazon/nova-2-lite-v1",
    "name": "Amazon: Nova 2 Lite",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 2.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/ministral-14b-2512",
    "name": "Mistral: Ministral 3 14B 2512",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.2,
      "output": 0.2,
      "cacheRead": 0.02,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/ministral-8b-2512",
    "name": "Mistral: Ministral 3 8B 2512",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.15,
      "output": 0.15,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/ministral-8b-2512:batch",
    "name": "Mistral: Ministral 3 8B 2512 (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.075,
      "output": 0.075,
      "cacheRead": 0.0075,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/ministral-3b-2512",
    "name": "Mistral: Ministral 3 3B 2512",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 104857,
    "cost": {
      "input": 0.1,
      "output": 0.1,
      "cacheRead": 0.01,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-large-2512",
    "name": "Mistral: Mistral Large 3 2512",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.5,
      "output": 1.5,
      "cacheRead": 0.05,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-large-2512:batch",
    "name": "Mistral: Mistral Large 3 2512 (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 209715,
    "cost": {
      "input": 0.25,
      "output": 0.75,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-v3.2",
    "name": "DeepSeek: DeepSeek V3.2",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.269,
      "output": 0.4,
      "cacheRead": 0.1345,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-opus-4.5",
    "name": "Anthropic: Claude Opus 4.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 5.0,
      "output": 25.0,
      "cacheRead": 0.5,
      "cacheWrite": 6.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-4.5:batch",
    "name": "Anthropic: Claude Opus 4.5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.25,
      "cacheWrite": 3.125
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "google/gemini-3-pro-image-preview",
    "name": "Google: Nano Banana Pro (Gemini 3 Pro Image Preview)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 65536,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.375
    }
  },
  {
    "id": "openai/gpt-5.1",
    "name": "OpenAI: GPT-5.1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.1:batch",
    "name": "OpenAI: GPT-5.1 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.625,
      "output": 5.0,
      "cacheRead": 0.0625,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.1-codex",
    "name": "OpenAI: GPT-5.1-Codex",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.13,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5.1-codex-mini",
    "name": "OpenAI: GPT-5.1-Codex-Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 2.0,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "moonshotai/kimi-k2-thinking",
    "name": "MoonshotAI: Kimi K2 Thinking",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 100352,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.6,
      "output": 2.5,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "amazon/nova-premier-v1",
    "name": "Amazon: Nova Premier 1.0",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 32000,
    "cost": {
      "input": 2.5,
      "output": 12.5,
      "cacheRead": 0.625,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perplexity/sonar-pro-search",
    "name": "Perplexity: Sonar Pro Search",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 8000,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/voxtral-small-24b-2507",
    "name": "Mistral: Voxtral Small 24B 2507",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 26214,
    "cost": {
      "input": 0.1,
      "output": 0.3,
      "cacheRead": 0.01,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-oss-safeguard-20b",
    "name": "OpenAI: gpt-oss-safeguard-20b",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.075,
      "output": 0.3,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "minimax/minimax-m2",
    "name": "MiniMax: MiniMax M2",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.255,
      "output": 1.02,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-vl-32b-instruct",
    "name": "Qwen: Qwen3 VL 32B Instruct",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "cost": {
      "input": 0.104,
      "output": 0.416,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "ibm-granite/granite-4.0-h-micro",
    "name": "IBM: Granite 4.0 Micro",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131000,
    "maxTokens": 117900,
    "cost": {
      "input": 0.017,
      "output": 0.112,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5-image-mini",
    "name": "OpenAI: GPT-5 Image Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 2.5,
      "output": 2.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "anthropic/claude-haiku-4.5",
    "name": "Anthropic: Claude Haiku 4.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.0,
      "output": 5.0,
      "cacheRead": 0.1,
      "cacheWrite": 1.25
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-haiku-4.5:batch",
    "name": "Anthropic: Claude Haiku 4.5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.5,
      "output": 2.5,
      "cacheRead": 0.05,
      "cacheWrite": 0.625
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "qwen/qwen3-vl-8b-thinking",
    "name": "Qwen: Qwen3 VL 8B Thinking",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.18,
      "output": 2.1,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-vl-8b-instruct",
    "name": "Qwen: Qwen3 VL 8B Instruct",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "cost": {
      "input": 0.117,
      "output": 0.455,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5-image",
    "name": "OpenAI: GPT-5 Image",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 10.0,
      "output": 10.0,
      "cacheRead": 1.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "google/gemini-2.5-flash-image",
    "name": "Google: Nano Banana (Gemini 2.5 Flash Image)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 32768,
    "maxTokens": 8192,
    "cost": {
      "input": 0.3,
      "output": 2.5,
      "cacheRead": 0.03,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "qwen/qwen3-vl-30b-a3b-thinking",
    "name": "Qwen: Qwen3 VL 30B A3B Thinking",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.2,
      "output": 2.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-vl-30b-a3b-instruct",
    "name": "Qwen: Qwen3 VL 30B A3B Instruct",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5-pro",
    "name": "OpenAI: GPT-5 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 15.0,
      "output": 120.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5-pro:batch",
    "name": "OpenAI: GPT-5 Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 7.5,
      "output": 60.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "z-ai/glm-4.6",
    "name": "Z.ai: GLM 4.6",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 204800,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.43,
      "output": 1.75,
      "cacheRead": 0.08,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-sonnet-4.5",
    "name": "Anthropic: Claude Sonnet 4.5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.3,
      "cacheWrite": 3.75,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 6.0,
          "output": 22.5,
          "cacheRead": 0.6,
          "cacheWrite": 7.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-sonnet-4.5:batch",
    "name": "Anthropic: Claude Sonnet 4.5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.5,
      "output": 7.5,
      "cacheRead": 0.15,
      "cacheWrite": 1.875,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 3.0,
          "output": 11.25,
          "cacheRead": 0.3,
          "cacheWrite": 3.75
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "deepseek/deepseek-v3.2-exp",
    "name": "DeepSeek: DeepSeek V3.2 Exp",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.27,
      "output": 0.41,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thedrummer/cydonia-24b-v4.1",
    "name": "TheDrummer: Cydonia 24B V4.1",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "cost": {
      "input": 0.3,
      "output": 0.5,
      "cacheRead": 0.15,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "relace/relace-apply-3",
    "name": "Relace: Relace Apply 3",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 128000,
    "cost": {
      "input": 0.85,
      "output": 1.25,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-vl-235b-a22b-thinking",
    "name": "Qwen: Qwen3 VL 235B A22B Thinking",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.4,
      "output": 4.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-vl-235b-a22b-instruct",
    "name": "Qwen: Qwen3 VL 235B A22B Instruct",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "cost": {
      "input": 0.21,
      "output": 1.9,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-max",
    "name": "Qwen: Qwen3 Max",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "cost": {
      "input": 0.78,
      "output": 3.9,
      "cacheRead": 0.156,
      "cacheWrite": 0.975,
      "tiers": [
        {
          "inputTokensAbove": 32000,
          "input": 1.56,
          "output": 7.8,
          "cacheRead": 0.312,
          "cacheWrite": 1.95
        },
        {
          "inputTokensAbove": 128000,
          "input": 1.95,
          "output": 9.75,
          "cacheRead": 0.39,
          "cacheWrite": 2.4375
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3-coder-plus",
    "name": "Qwen: Qwen3 Coder Plus",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "cost": {
      "input": 0.65,
      "output": 3.25,
      "cacheRead": 0.13,
      "cacheWrite": 0.8125,
      "tiers": [
        {
          "inputTokensAbove": 32000,
          "input": 1.17,
          "output": 5.85,
          "cacheRead": 0.234,
          "cacheWrite": 1.4625
        },
        {
          "inputTokensAbove": 128000,
          "input": 1.95,
          "output": 9.75,
          "cacheRead": 0.39,
          "cacheWrite": 2.4375
        }
      ]
    }
  },
  {
    "id": "deepseek/deepseek-v3.1-terminus",
    "name": "DeepSeek: DeepSeek V3.1 Terminus",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.27,
      "output": 1.0,
      "cacheRead": 0.135,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-coder-flash",
    "name": "Qwen: Qwen3 Coder Flash",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "cost": {
      "input": 0.195,
      "output": 0.975,
      "cacheRead": 0.039,
      "cacheWrite": 0.24375,
      "tiers": [
        {
          "inputTokensAbove": 32000,
          "input": 0.325,
          "output": 1.625,
          "cacheRead": 0.065,
          "cacheWrite": 0.40625
        },
        {
          "inputTokensAbove": 128000,
          "input": 0.52,
          "output": 2.6,
          "cacheRead": 0.104,
          "cacheWrite": 0.65
        }
      ]
    }
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-thinking",
    "name": "Qwen: Qwen3 Next 80B A3B Thinking",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.15,
      "output": 1.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-instruct",
    "name": "Qwen: Qwen3 Next 80B A3B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "cost": {
      "input": 0.09,
      "output": 1.1,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen-plus-2025-07-28",
    "name": "Qwen: Qwen Plus 0728",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 32768,
    "cost": {
      "input": 0.26,
      "output": 0.78,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.78,
          "output": 2.34,
          "cacheRead": 0.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "moonshotai/kimi-k2-0905",
    "name": "MoonshotAI: Kimi K2 0905",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 100352,
    "cost": {
      "input": 0.6,
      "output": 2.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-30b-a3b-thinking-2507",
    "name": "Qwen: Qwen3 30B A3B Thinking 2507",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 81920,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.2,
      "output": 2.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nousresearch/hermes-4-405b",
    "name": "Nous: Hermes 4 405B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.0,
      "output": 3.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-chat-v3.1",
    "name": "DeepSeek: DeepSeek V3.1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.25,
      "output": 0.95,
      "cacheRead": 0.13,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-medium-3.1",
    "name": "Mistral: Mistral Medium 3.1",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 104857,
    "cost": {
      "input": 0.4,
      "output": 2.0,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-medium-3.1:batch",
    "name": "Mistral: Mistral Medium 3.1 (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 104857,
    "cost": {
      "input": 0.2,
      "output": 1.0,
      "cacheRead": 0.02,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-4.5v",
    "name": "Z.ai: GLM 4.5V",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 65536,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.6,
      "output": 1.8,
      "cacheRead": 0.11,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-5",
    "name": "OpenAI: GPT-5",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5:batch",
    "name": "OpenAI: GPT-5 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.625,
      "output": 5.0,
      "cacheRead": 0.0625,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5-mini",
    "name": "OpenAI: GPT-5 Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.25,
      "output": 2.0,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5-mini:batch",
    "name": "OpenAI: GPT-5 Mini (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.125,
      "output": 1.0,
      "cacheRead": 0.0125,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5-nano",
    "name": "OpenAI: GPT-5 Nano",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.05,
      "output": 0.4,
      "cacheRead": 0.005,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-5-nano:batch",
    "name": "OpenAI: GPT-5 Nano (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 400000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": "minimal",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.025,
      "output": 0.2,
      "cacheRead": 0.0025,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-oss-120b",
    "name": "OpenAI: gpt-oss-120b",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.037,
      "output": 0.17,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-oss-120b:batch",
    "name": "OpenAI: gpt-oss-120b (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-oss-20b",
    "name": "OpenAI: gpt-oss-20b",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.03,
      "output": 0.13,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-oss-20b:batch",
    "name": "OpenAI: gpt-oss-20b (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 0.05,
      "output": 0.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "anthropic/claude-opus-4.1",
    "name": "Anthropic: Claude Opus 4.1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 32000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 15.0,
      "output": 75.0,
      "cacheRead": 1.5,
      "cacheWrite": 18.75
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-opus-4.1:batch",
    "name": "Anthropic: Claude Opus 4.1 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 32000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 7.5,
      "output": 37.5,
      "cacheRead": 0.75,
      "cacheWrite": 9.375
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "mistralai/codestral-2508",
    "name": "Mistral: Codestral 2508",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 204800,
    "cost": {
      "input": 0.3,
      "output": 0.9,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/codestral-2508:batch",
    "name": "Mistral: Codestral 2508 (batch)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 204800,
    "cost": {
      "input": 0.15,
      "output": 0.45,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-coder-30b-a3b-instruct",
    "name": "Qwen: Qwen3 Coder 30B A3B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 235929,
    "cost": {
      "input": 0.07,
      "output": 0.28,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-30b-a3b-instruct-2507",
    "name": "Qwen: Qwen3 30B A3B Instruct 2507",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 32000,
    "cost": {
      "input": 0.04815,
      "output": 0.19305,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-4.5",
    "name": "Z.ai: GLM 4.5",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 98304,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.6,
      "output": 2.2,
      "cacheRead": 0.11,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "z-ai/glm-4.5-air",
    "name": "Z.ai: GLM 4.5 Air",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 98304,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.13,
      "output": 0.85,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-235b-a22b-thinking-2507",
    "name": "Qwen: Qwen3 235B A22B Thinking 2507",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.23,
      "output": 2.3,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-coder",
    "name": "Qwen: Qwen3 Coder 480B A35B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 65536,
    "cost": {
      "input": 0.3,
      "output": 1.0,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "bytedance/ui-tars-1.5-7b",
    "name": "ByteDance: UI-TARS 7B ",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 2048,
    "cost": {
      "input": 0.1,
      "output": 0.2,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-2.5-flash-lite",
    "name": "Google: Gemini 2.5 Flash Lite",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.1,
      "output": 0.4,
      "cacheRead": 0.01,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-2.5-flash-lite:batch",
    "name": "Google: Gemini 2.5 Flash Lite (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.05,
      "output": 0.2,
      "cacheRead": 0.01,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-235b-a22b-2507",
    "name": "Qwen: Qwen3 235B A22B Instruct 2507",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 16384,
    "cost": {
      "input": 0.22,
      "output": 0.88,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "moonshotai/kimi-k2",
    "name": "MoonshotAI: Kimi K2 0711",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 100352,
    "cost": {
      "input": 0.57,
      "output": 2.3,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    "name": "Venice: Uncensored",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 8192,
    "cost": {
      "input": 0.2,
      "output": 0.9,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "tencent/hunyuan-a13b-instruct",
    "name": "Tencent: Hunyuan A13B Instruct",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.14,
      "output": 0.57,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "morph/morph-v3-large",
    "name": "Morph: Morph V3 Large",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "cost": {
      "input": 0.9,
      "output": 1.9,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "morph/morph-v3-fast",
    "name": "Morph: Morph V3 Fast",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 81920,
    "maxTokens": 38000,
    "cost": {
      "input": 0.8,
      "output": 1.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "baidu/ernie-4.5-vl-424b-a47b",
    "name": "Baidu: ERNIE 4.5 VL 424B A47B ",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 123000,
    "maxTokens": 16000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.42,
      "output": 1.25,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-small-3.2-24b-instruct",
    "name": "Mistral: Mistral Small 3.2 24B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.075,
      "output": 0.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-m1",
    "name": "MiniMax: MiniMax M1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 40000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.55,
      "output": 2.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-2.5-flash",
    "name": "Google: Gemini 2.5 Flash",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.3,
      "output": 2.5,
      "cacheRead": 0.03,
      "cacheWrite": 0.0833333333333333
    }
  },
  {
    "id": "google/gemini-2.5-flash:batch",
    "name": "Google: Gemini 2.5 Flash (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.15,
      "output": 1.25,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-2.5-pro",
    "name": "Google: Gemini 2.5 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 15.0,
          "cacheRead": 0.25,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "google/gemini-2.5-pro:batch",
    "name": "Google: Gemini 2.5 Pro (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.625,
      "output": 5.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 1.25,
          "output": 7.5,
          "cacheRead": 0.25,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "openai/o3-pro",
    "name": "OpenAI: o3 Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 20.0,
      "output": 80.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "google/gemini-2.5-pro-preview",
    "name": "Google: Gemini 2.5 Pro Preview 06-05",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 15.0,
          "cacheRead": 0.25,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "deepseek/deepseek-r1-0528",
    "name": "DeepSeek: R1 0528",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.5,
      "output": 2.15,
      "cacheRead": 0.35,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthropic/claude-opus-4",
    "name": "Anthropic: Claude Opus 4",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 32000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 15.0,
      "output": 75.0,
      "cacheRead": 1.5,
      "cacheWrite": 18.75
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "anthropic/claude-sonnet-4",
    "name": "Anthropic: Claude Sonnet 4",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 64000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.3,
      "cacheWrite": 3.75,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 6.0,
          "output": 22.5,
          "cacheRead": 0.6,
          "cacheWrite": 7.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "mistralai/mistral-medium-3",
    "name": "Mistral: Mistral Medium 3",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 104857,
    "cost": {
      "input": 0.4,
      "output": 2.0,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemini-2.5-pro-preview-05-06",
    "name": "Google: Gemini 2.5 Pro Preview 05-06",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 65535,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 1.25,
      "output": 10.0,
      "cacheRead": 0.125,
      "cacheWrite": 0.375,
      "tiers": [
        {
          "inputTokensAbove": 200000,
          "input": 2.5,
          "output": 15.0,
          "cacheRead": 0.25,
          "cacheWrite": 0.375
        }
      ]
    }
  },
  {
    "id": "meta-llama/llama-guard-4-12b",
    "name": "Meta: Llama Guard 4 12B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 163840,
    "maxTokens": 16384,
    "cost": {
      "input": 0.18,
      "output": 0.18,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-30b-a3b",
    "name": "Qwen: Qwen3 30B A3B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.12,
      "output": 0.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-8b",
    "name": "Qwen: Qwen3 8B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.117,
      "output": 0.455,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-14b",
    "name": "Qwen: Qwen3 14B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.2275,
      "output": 0.91,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-32b",
    "name": "Qwen: Qwen3 32B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.08,
      "output": 0.28,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen3-235b-a22b",
    "name": "Qwen: Qwen3 235B A22B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.455,
      "output": 1.82,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/o4-mini-high",
    "name": "OpenAI: o4 Mini High",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.1,
      "output": 4.4,
      "cacheRead": 0.275,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/o3",
    "name": "OpenAI: o3",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 2.0,
      "output": 8.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/o3:batch",
    "name": "OpenAI: o3 (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.0,
      "output": 4.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/o4-mini",
    "name": "OpenAI: o4 Mini",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.1,
      "output": 4.4,
      "cacheRead": 0.275,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/o4-mini:batch",
    "name": "OpenAI: o4 Mini (batch)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.55,
      "output": 2.2,
      "cacheRead": 0.1375,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1",
    "name": "OpenAI: GPT-4.1",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 2.0,
      "output": 8.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1:batch",
    "name": "OpenAI: GPT-4.1 (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 1.0,
      "output": 4.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1-mini",
    "name": "OpenAI: GPT-4.1 Mini",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 0.4,
      "output": 1.6,
      "cacheRead": 0.1,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1-mini:batch",
    "name": "OpenAI: GPT-4.1 Mini (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 0.2,
      "output": 0.8,
      "cacheRead": 0.05,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1-nano",
    "name": "OpenAI: GPT-4.1 Nano",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 0.1,
      "output": 0.4,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4.1-nano:batch",
    "name": "OpenAI: GPT-4.1 Nano (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1047576,
    "maxTokens": 32768,
    "cost": {
      "input": 0.05,
      "output": 0.2,
      "cacheRead": 0.0125,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "meta-llama/llama-4-maverick",
    "name": "Meta: Llama 4 Maverick",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 115200,
    "cost": {
      "input": 0.2,
      "output": 0.696,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta-llama/llama-4-scout",
    "name": "Meta: Llama 4 Scout",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1310720,
    "maxTokens": 16384,
    "cost": {
      "input": 0.1,
      "output": 0.3,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-chat-v3-0324",
    "name": "DeepSeek: DeepSeek V3 0324",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 147456,
    "cost": {
      "input": 0.29,
      "output": 1.14,
      "cacheRead": 0.11,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/o1-pro",
    "name": "OpenAI: o1-pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 150.0,
      "output": 600.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/mistral-small-3.1-24b-instruct",
    "name": "Mistral: Mistral Small 3.1 24B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 102400,
    "cost": {
      "input": 0.351,
      "output": 0.555,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-3-4b-it",
    "name": "Google: Gemma 3 4B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.05,
      "output": 0.1,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-3-12b-it",
    "name": "Google: Gemma 3 12B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.05,
      "output": 0.15,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "cohere/command-a",
    "name": "Cohere: Command A",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 256000,
    "maxTokens": 8192,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "rekaai/reka-flash-3",
    "name": "Reka Flash 3",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 65536,
    "maxTokens": 58982,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.1,
      "output": 0.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "google/gemma-3-27b-it",
    "name": "Google: Gemma 3 27B",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "cost": {
      "input": 0.08,
      "output": 0.45,
      "cacheRead": 0.04,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thedrummer/skyfall-36b-v2",
    "name": "TheDrummer: Skyfall 36B V2",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 29491,
    "cost": {
      "input": 0.55,
      "output": 0.8,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perplexity/sonar-reasoning-pro",
    "name": "Perplexity: Sonar Reasoning Pro",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 115200,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 2.0,
      "output": 8.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perplexity/sonar-pro",
    "name": "Perplexity: Sonar Pro",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 8000,
    "cost": {
      "input": 3.0,
      "output": 15.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perplexity/sonar-deep-research",
    "name": "Perplexity: Sonar Deep Research",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 115200,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 2.0,
      "output": 8.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-saba",
    "name": "Mistral: Saba",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 26214,
    "cost": {
      "input": 0.2,
      "output": 0.6,
      "cacheRead": 0.02,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/o3-mini-high",
    "name": "OpenAI: o3 Mini High",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": null
    },
    "cost": {
      "input": 1.1,
      "output": 4.4,
      "cacheRead": 0.55,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "aion-labs/aion-rp-llama-3.1-8b",
    "name": "AionLabs: Aion-RP 1.0 (8B)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 29491,
    "cost": {
      "input": 0.8,
      "output": 1.6,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen2.5-vl-72b-instruct",
    "name": "Qwen: Qwen2.5 VL 72B Instruct",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 115200,
    "cost": {
      "input": 0.8,
      "output": 1.0,
      "cacheRead": 0.4,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen-plus",
    "name": "Qwen: Qwen-Plus",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1000000,
    "maxTokens": 32768,
    "cost": {
      "input": 0.26,
      "output": 0.78,
      "cacheRead": 0.052,
      "cacheWrite": 0.325,
      "tiers": [
        {
          "inputTokensAbove": 256000,
          "input": 0.78,
          "output": 2.34,
          "cacheRead": 0.156,
          "cacheWrite": 0.975
        }
      ]
    }
  },
  {
    "id": "openai/o3-mini",
    "name": "OpenAI: o3 Mini",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 1.1,
      "output": 4.4,
      "cacheRead": 0.55,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/o3-mini:batch",
    "name": "OpenAI: o3 Mini (batch)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.55,
      "output": 2.2,
      "cacheRead": 0.275,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/mistral-small-24b-instruct-2501",
    "name": "Mistral: Mistral Small 3",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 16384,
    "cost": {
      "input": 0.05,
      "output": 0.08,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "perplexity/sonar",
    "name": "Perplexity: Sonar",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 127072,
    "maxTokens": 114364,
    "cost": {
      "input": 1.0,
      "output": 1.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-r1-distill-llama-70b",
    "name": "DeepSeek: R1 Distill Llama 70B",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 7372,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.8,
      "output": 0.8,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-r1",
    "name": "DeepSeek: R1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 64000,
    "maxTokens": 16000,
    "thinkingLevelMap": {
      "off": null
    },
    "cost": {
      "input": 0.7,
      "output": 2.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "minimax/minimax-01",
    "name": "MiniMax: MiniMax-01",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000192,
    "maxTokens": 900172,
    "cost": {
      "input": 0.2,
      "output": 1.1,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "microsoft/phi-4",
    "name": "Microsoft: Phi 4",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 16384,
    "maxTokens": 14745,
    "cost": {
      "input": 0.07,
      "output": 0.14,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "deepseek/deepseek-chat",
    "name": "DeepSeek: DeepSeek V3",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 163840,
    "maxTokens": 16000,
    "cost": {
      "input": 0.2574,
      "output": 1.0287,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sao10k/l3.3-euryale-70b",
    "name": "Sao10K: Llama 3.3 Euryale 70B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.65,
      "output": 0.75,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/o1",
    "name": "OpenAI: o1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 100000,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 15.0,
      "output": 60.0,
      "cacheRead": 7.5,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "cohere/command-r7b-12-2024",
    "name": "Cohere: Command R7B (12-2024)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 4000,
    "cost": {
      "input": 0.0375,
      "output": 0.15,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta-llama/llama-3.3-70b-instruct",
    "name": "Meta: Llama 3.3 70B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.1,
      "output": 0.32,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "amazon/nova-lite-v1",
    "name": "Amazon: Nova Lite 1.0",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 300000,
    "maxTokens": 5120,
    "cost": {
      "input": 0.06,
      "output": 0.24,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "amazon/nova-micro-v1",
    "name": "Amazon: Nova Micro 1.0",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 5120,
    "cost": {
      "input": 0.035,
      "output": 0.14,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "amazon/nova-pro-v1",
    "name": "Amazon: Nova Pro 1.0",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 300000,
    "maxTokens": 5120,
    "cost": {
      "input": 0.8,
      "output": 3.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-4o-2024-11-20",
    "name": "OpenAI: GPT-4o (2024-11-20)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 1.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/mistral-large-2407",
    "name": "Mistral Large 2407",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 104857,
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen-2.5-coder-32b-instruct",
    "name": "Qwen2.5 Coder 32B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 29491,
    "cost": {
      "input": 0.66,
      "output": 1.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "thedrummer/unslopnemo-12b",
    "name": "TheDrummer: UnslopNemo 12B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 1024000,
    "maxTokens": 819200,
    "cost": {
      "input": 0.4,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "anthracite-org/magnum-v4-72b",
    "name": "Magnum v4 72B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 4096,
    "cost": {
      "input": 2.5,
      "output": 5.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen-2.5-7b-instruct",
    "name": "Qwen: Qwen2.5 7B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 29491,
    "cost": {
      "input": 0.1,
      "output": 0.2,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta-llama/llama-3.2-1b-instruct",
    "name": "Meta: Llama 3.2 1B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 60000,
    "maxTokens": 54000,
    "cost": {
      "input": 0.027,
      "output": 0.201,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta-llama/llama-3.2-3b-instruct",
    "name": "Meta: Llama 3.2 3B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "cost": {
      "input": 0.05,
      "output": 0.33,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "qwen/qwen-2.5-72b-instruct",
    "name": "Qwen2.5 72B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 16384,
    "cost": {
      "input": 0.36,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "cohere/command-r-08-2024",
    "name": "Cohere: Command R (08-2024)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 4000,
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "cohere/command-r-plus-08-2024",
    "name": "Cohere: Command R+ (08-2024)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 4000,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sao10k/l3.1-euryale-70b",
    "name": "Sao10K: Llama 3.1 Euryale 70B v2.2",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.85,
      "output": 0.85,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nousresearch/hermes-3-llama-3.1-70b",
    "name": "Nous: Hermes 3 70B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.7,
      "output": 0.7,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "nousresearch/hermes-3-llama-3.1-405b",
    "name": "Nous: Hermes 3 405B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 1.0,
      "output": 1.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sao10k/l3-lunaris-8b",
    "name": "Sao10K: Llama 3 8B Lunaris",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 7372,
    "cost": {
      "input": 0.04,
      "output": 0.05,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-4o-2024-08-06",
    "name": "OpenAI: GPT-4o (2024-08-06)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 1.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "meta-llama/llama-3.1-70b-instruct",
    "name": "Meta: Llama 3.1 70B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.4,
      "output": 0.4,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "meta-llama/llama-3.1-8b-instruct",
    "name": "Meta: Llama 3.1 8B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 117964,
    "cost": {
      "input": 0.05,
      "output": 0.08,
      "cacheRead": 0.025,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "mistralai/mistral-nemo",
    "name": "Mistral: Mistral Nemo",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 131072,
    "maxTokens": 16384,
    "cost": {
      "input": 0.019,
      "output": 0.03,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-4o-mini",
    "name": "OpenAI: GPT-4o-mini",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.075,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4o-mini-2024-07-18",
    "name": "OpenAI: GPT-4o-mini (2024-07-18)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.075,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4o-mini:batch",
    "name": "OpenAI: GPT-4o-mini (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 0.075,
      "output": 0.3,
      "cacheRead": 0.0375,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "google/gemma-2-27b-it",
    "name": "Google: Gemma 2 27B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 2048,
    "cost": {
      "input": 0.65,
      "output": 0.65,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-4o",
    "name": "OpenAI: GPT-4o",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 2.5,
      "output": 10.0,
      "cacheRead": 1.25,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4o-2024-05-13",
    "name": "OpenAI: GPT-4o (2024-05-13)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 4096,
    "cost": {
      "input": 5.0,
      "output": 15.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4o:batch",
    "name": "OpenAI: GPT-4o (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 16384,
    "cost": {
      "input": 1.25,
      "output": 5.0,
      "cacheRead": 0.625,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mistralai/mixtral-8x22b-instruct",
    "name": "Mistral: Mixtral 8x22B Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 65536,
    "maxTokens": 52428,
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "microsoft/wizardlm-2-8x22b",
    "name": "WizardLM-2 8x22B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 65535,
    "maxTokens": 8000,
    "cost": {
      "input": 0.62,
      "output": 0.62,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-4-turbo",
    "name": "OpenAI: GPT-4 Turbo",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 4096,
    "cost": {
      "input": 10.0,
      "output": 30.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4-turbo:batch",
    "name": "OpenAI: GPT-4 Turbo (batch)",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 128000,
    "maxTokens": 4096,
    "cost": {
      "input": 5.0,
      "output": 15.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "anthropic/claude-3-haiku",
    "name": "Anthropic: Claude 3 Haiku",
    "reasoning": false,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 200000,
    "maxTokens": 4096,
    "cost": {
      "input": 0.25,
      "output": 1.25,
      "cacheRead": 0.03,
      "cacheWrite": 0.3
    },
    "compat": {
      "supportsDeveloperRole": true,
      "cacheControlFormat": "anthropic"
    }
  },
  {
    "id": "mistralai/mistral-large",
    "name": "Mistral Large",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 102400,
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.2,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-3.5-turbo-0613",
    "name": "OpenAI: GPT-3.5 Turbo (older v0613)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 4095,
    "maxTokens": 3685,
    "cost": {
      "input": 1.0,
      "output": 2.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4-turbo-preview",
    "name": "OpenAI: GPT-4 Turbo Preview",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 4096,
    "cost": {
      "input": 10.0,
      "output": 30.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openrouter/auto",
    "name": "Auto Router",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 2000000,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-3.5-turbo-instruct",
    "name": "OpenAI: GPT-3.5 Turbo Instruct",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 4095,
    "maxTokens": 3685,
    "cost": {
      "input": 1.5,
      "output": 2.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-3.5-turbo-16k",
    "name": "OpenAI: GPT-3.5 Turbo 16k",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 16385,
    "maxTokens": 4096,
    "cost": {
      "input": 3.0,
      "output": 4.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "mancer/weaver",
    "name": "Mancer: Weaver (alpha)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8000,
    "maxTokens": 6000,
    "cost": {
      "input": 0.4,
      "output": 0.75,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "undi95/remm-slerp-l2-13b",
    "name": "ReMM SLERP 13B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 6144,
    "maxTokens": 5529,
    "cost": {
      "input": 0.35,
      "output": 0.65,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "gryphe/mythomax-l2-13b",
    "name": "MythoMax 13B",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8192,
    "maxTokens": 3686,
    "cost": {
      "input": 0.06,
      "output": 0.06,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "openai/gpt-3.5-turbo",
    "name": "OpenAI: GPT-3.5 Turbo",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 16385,
    "maxTokens": 4096,
    "cost": {
      "input": 0.5,
      "output": 1.5,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-3.5-turbo:batch",
    "name": "OpenAI: GPT-3.5 Turbo (batch)",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 16385,
    "maxTokens": 4096,
    "cost": {
      "input": 0.25,
      "output": 0.75,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "openai/gpt-4",
    "name": "OpenAI: GPT-4",
    "reasoning": false,
    "input": [
      "text"
    ],
    "contextWindow": 8191,
    "maxTokens": 4096,
    "cost": {
      "input": 30.0,
      "output": 60.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "stealth/union-alpha",
    "name": "Union Alpha",
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 131072,
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    },
    "reasoning": false
  },
  {
    "id": "inclusionai/ling-3.0-flash-vl",
    "name": "inclusionAI: Ling 3.0 Flash VL",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.06,
      "output": 0.18,
      "cacheRead": 0.012,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "inclusionai/ling-3.0-flash-vl:free",
    "name": "inclusionAI: Ling 3.0 Flash VL (free)",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 262144,
    "maxTokens": 32768,
    "thinkingLevelMap": {
      "off": "none"
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "inference-net/schematron-v2-small",
    "name": "Inference.net: Schematron V2 Small",
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 4096,
    "cost": {
      "input": 0.05,
      "output": 0.23,
      "cacheRead": 0.05,
      "cacheWrite": 0.0
    },
    "reasoning": false
  },
  {
    "id": "inference-net/schematron-v2-turbo",
    "name": "Inference.net: Schematron V2 Turbo",
    "input": [
      "text"
    ],
    "contextWindow": 128000,
    "maxTokens": 8192,
    "cost": {
      "input": 0.03,
      "output": 0.15,
      "cacheRead": 0.03,
      "cacheWrite": 0.0
    },
    "reasoning": false
  },
  {
    "id": "sakana/fugu-max",
    "name": "Sakana: Fugu Max",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 6.0,
      "cacheRead": 0.25,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "sakana/fugu-ultra-v2",
    "name": "Sakana: Fugu Ultra v2",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1000000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 5.0,
      "output": 30.0,
      "cacheRead": 0.5,
      "cacheWrite": 0.0,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 10.0,
          "output": 45.0,
          "cacheRead": 1.0,
          "cacheWrite": 0.0
        }
      ]
    }
  },
  {
    "id": "z-ai/glm-5.2:free",
    "name": "Z.ai: GLM 5.2 (free)",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 32768,
    "maxTokens": 29491,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.0,
      "output": 0.0,
      "cacheRead": 0.0,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~deepseek/deepseek-flash-latest",
    "name": "DeepSeek: DeepSeek Flash Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1048576,
    "maxTokens": 393216,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": null,
      "high": "high",
      "xhigh": null,
      "max": "max"
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~deepseek/deepseek-pro-latest",
    "name": "DeepSeek: DeepSeek Pro Latest",
    "reasoning": true,
    "input": [
      "text"
    ],
    "contextWindow": 1048576,
    "maxTokens": 393216,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": null,
      "medium": null,
      "high": "high",
      "xhigh": "xhigh",
      "max": null
    },
    "cost": {
      "input": 0.5808,
      "output": 1.7424,
      "cacheRead": 0.05808,
      "cacheWrite": 0.0
    }
  },
  {
    "id": "~openai/gpt-astra-latest",
    "name": "OpenAI: GPT Astra Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 10.0,
      "output": 50.0,
      "cacheRead": 1.0,
      "cacheWrite": 12.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 20.0,
          "output": 75.0,
          "cacheRead": 2.0,
          "cacheWrite": 25.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "~openai/gpt-luna-latest",
    "name": "OpenAI: GPT Luna Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 0.2,
      "output": 1.2,
      "cacheRead": 0.02,
      "cacheWrite": 0.25,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 0.4,
          "output": 1.8,
          "cacheRead": 0.04,
          "cacheWrite": 0.5
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "~openai/gpt-sol-latest",
    "name": "OpenAI: GPT Sol Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 10.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 15.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  },
  {
    "id": "~openai/gpt-terra-latest",
    "name": "OpenAI: GPT Terra Latest",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "contextWindow": 1050000,
    "maxTokens": 128000,
    "thinkingLevelMap": {
      "off": "none",
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": "xhigh",
      "max": "max"
    },
    "cost": {
      "input": 2.0,
      "output": 12.0,
      "cacheRead": 0.2,
      "cacheWrite": 2.5,
      "tiers": [
        {
          "inputTokensAbove": 272000,
          "input": 4.0,
          "output": 18.0,
          "cacheRead": 0.4,
          "cacheWrite": 5.0
        }
      ]
    },
    "compat": {
      "supportsDeveloperRole": true
    }
  }
];
