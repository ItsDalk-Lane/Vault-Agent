import React from "react";
import {
  AgentRecoveryNotice,
  type AgentRecoveryNoticeProps,
} from "@/agentMode/ui/AgentRecoveryNotice";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Recovery",
  component: AgentRecoveryNotice,
  args: {
    recovery: {
      status: "available",
      pendingPermissionIds: [],
      pendingQuestionIds: [],
      pendingMutationIds: [],
      crashLoopTripped: false,
      message: "上次工作未完成。继续前会重新检查权限和实际文件状态。",
    },
    onRecover: async () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentRecoveryNoticeProps>;
export default meta;

export const Interrupted: StoryObj<AgentRecoveryNoticeProps> = {};
export const UnsentInput: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      message:
        "这条请求尚未发送，原文和附件引用已保存。点击“继续”后才会发送；停止会放弃这条待发请求。",
    },
  },
};
export const RuntimeBusyHistory: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "read_only",
      reloadAvailable: true,
      message:
        "其他聊天占用了当前执行位置，现显示最近保存的只读历史。不会自动排队或继续工作；可在空位释放后点击“重新载入”，只核对并更新记录。",
    },
  },
};
export const RepeatedCrashes: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "read_only",
      crashLoopTripped: true,
      message: "这项工作连续异常退出。查看记录后，可手动选择再试一次。",
    },
  },
};
export const NewerVersion: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "read_only",
      message: "此记录由更新版本保存，请使用兼容版本打开。",
    },
  },
};
export const StorageUnavailable: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "storage_failed",
      message: "暂时无法安全读取聊天记录。原记录保持不变。",
    },
  },
};

export const UnknownFileEffect: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "read_only",
      pendingMutationIds: ["operation-1"],
      message:
        "部分文件操作的结果尚未核对。核对只检查实际内容；也可结束未完成的工作，已发生的修改保留。",
    },
  },
};

export const UnknownExternalEffect: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      status: "read_only",
      pendingMutationIds: ["mcp:service:1:call"],
      message:
        "外部服务已收到操作，但回复中断。检查只读取已有事实，重连不能证明操作是否完成；无法证明时仍暂停，不会重发原操作。",
    },
  },
};

export const RemainingWorkAfterTurn: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    children: (
      <input
        aria-label="新的要求"
        placeholder="也可以直接发送新的要求"
        className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2 tw-text-normal"
      />
    ),
    recovery: {
      ...meta.args.recovery,
      continuationAvailable: true,
      interruptedRun: {
        runId: "work-1",
        requestId: "request-1",
        status: "completed",
        startedAtMs: 1,
        endedAtMs: 2,
        cancelEpoch: 0,
      },
      message:
        "本轮已结束，清单仍有剩余工作。点击继续会沿原目标启动下一段并追加32次请求额度；打开记录不会自动执行，也可直接发送新的要求。",
    },
  },
};

export const UserPaused: StoryObj<AgentRecoveryNoticeProps> = {
  args: {
    recovery: {
      ...meta.args.recovery,
      interruptedRun: {
        runId: "run-user",
        requestId: "request-user",
        status: "paused_user",
        startedAtMs: 1,
        cancelEpoch: 0,
      },
      message: "工作已按要求暂停，进度和已发生的修改保留。点击继续前不会重新执行。",
    },
  },
};
