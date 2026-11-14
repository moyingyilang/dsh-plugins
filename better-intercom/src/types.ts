/** Public message and peer records for session intercom. @module @deepseek-ai/dsh-experimental-session-intercom/types */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** One selectable target session, with metadata only and no conversation content. */
export interface IntercomPeer {
  /** Opaque session identity to pass back to {@link SendIntercomRequest.to}. */
  readonly sessionId: SessionId
  /** Latest log-backed title, or `untitled` when the title projection has no value. */
  readonly title: string
  /** Whether the session has a live Agent in this process. */
  readonly live: boolean
  /** Recorded working directory, when the session has one. */
  readonly workspace?: string
}

/** One bounded peer listing. */
export interface IntercomListing {
  /**
   * The caller itself.
   *
   * 存在的理由很实际：模型无法从别处知道自己的 session id，于是会在消息正文里
   * 凭猜测写一个「回我」的地址，收件方照着发就会失败。把身份直接回给调用方，
   * 这类错误就从「可能发生」变成「不可能发生」。
   */
  readonly self: IntercomSelf
  /** Other sessions visible to the caller, newest first. */
  readonly peers: readonly IntercomPeer[]
  /** Whether more visible peers exist beyond {@link IntercomListing.peers}. */
  readonly truncated: boolean
}

/** One explicit cross-session message request. */
export interface SendIntercomRequest {
  /** Target session identity. It must not be the caller. */
  readonly to: SessionId
  /** Message body delivered as the target's own user-role message. */
  readonly text: string
}

/** One accepted cross-session message. */
export interface SendIntercomResult {
  /** Identity of the user-role message accepted into the target inbox. */
  readonly messageId: MessageId
  /** Target metadata sampled when the message was accepted. */
  readonly target: IntercomPeer
}

/**
 * 一次「中转投递」请求：发送方身份按设计隐去，只留纯信息。
 *
 * 与 [SendIntercomRequest] 的区别是显式性：直接消息带着发送方标题与 id，
 * 接收方容易按来源权威而不是内容本身来评估；中转投递把来源从正文里拿掉，
 * 只保留可复现的依据，让接收方按信息本身判断。
 */
export interface RelayIntercomRequest {
  /** Target session identity. It must not be the caller. */
  readonly to: SessionId
  /** 纯信息正文：结论与事实，不写「我认为」「我的项目」这类身份线索。 */
  readonly summary: string
  /** 可选的可复现依据：命令、路径、版本号。接收方据此自行验证。 */
  readonly evidence?: string
}

/** 调用方的自身身份。 */
export interface IntercomSelf {
  /** 调用方自己的 session id，可直接用于回复。 */
  readonly sessionId: SessionId
  /** 调用方自己的标题。 */
  readonly title: string
}

/** Stable failure discriminators produced by the intercom service. */
export type IntercomErrorCode =
  | 'INTERCOM_INVALID_CONFIG'
  | 'INTERCOM_UNKNOWN_SESSION'
  | 'INTERCOM_SELF_MESSAGE'
  | 'INTERCOM_UNAUTHORIZED'
  | 'INTERCOM_SUBAGENT_TARGET'
  | 'INTERCOM_TARGET_INACTIVE'
  | 'INTERCOM_TARGET_UNAVAILABLE'
  | 'INTERCOM_MESSAGE_EMPTY'
  | 'INTERCOM_MESSAGE_TOO_LARGE'
