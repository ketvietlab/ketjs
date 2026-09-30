/**
 * What passing the membership gate costs in effects.
 *
 * Spread into every command that touches a project's data. Named because it is
 * not a capability one function happens to need — it is the condition all of
 * them read under, and a list copied at thirty call sites is a list that will
 * disagree with itself.
 */
export const membershipEffects = [
  'read:flow.Project',
  'read:flow.ProjectMember',
  'read:flow.ProjectAccessGrant',
  'read:user.User',
] as const

export const flowReadEffects = [
  'read:flow.Project',
  // The membership gate every Flow read now passes through — see membership.ts.
  // Named here rather than at each call site because it is not a capability one
  // function happens to need; it is the condition all of them read under.
  'read:flow.ProjectMember',
  'read:flow.ProjectAccessGrant',
  'read:flow.Column',
  'read:flow.IssueType',
  'read:flow.FieldDef',
  'read:mail.Follower',
  'read:flow.IssueFieldValue',
  'read:flow.Epic',
  'read:flow.Sprint',
  'read:flow.Issue',
  'read:flow.IssueDependency',
  'read:flow.Tag',
  'read:flow.IssueTag',
  'read:user.User',
  'read:mail.Thread',
  'read:mail.Message',
] as const

/**
 * What writing one system entry to an issue's thread costs in effects.
 *
 * `postMessage` resolves the author, addresses the followers and writes the
 * notification, so a command that leaves a timeline entry touches the same mail
 * tables a comment does. Named here because three commands now do it.
 */
export const timelineEntryEffects = [
  'read:mail.Thread',
  'read:mail.Follower',
  'write:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Message',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'read:user.User',
  'read:partner.Partner',
] as const

export const issueWriteEffects = [
  ...flowReadEffects,
  'write:flow.Issue',
  'write:flow.IssueTag',
  'write:flow.IssueFieldValue',
  'write:mail.Thread',
  // Saving an issue now subscribes its author and its assignee to the thread,
  // and writes a system entry when it changes hands — so it touches the same
  // mail tables a comment does.
  'read:mail.Follower',
  'write:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Message',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'read:partner.Partner',
] as const

export const commentEffects = [
  'read:flow.Issue',
  'read:mail.Thread',
  'write:mail.Thread',
  'read:mail.Message',
  'write:mail.Message',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'write:mail.Follower',
  'write:mail.FollowerSubtype',
  'read:user.User',
  'read:partner.Partner',
] as const
