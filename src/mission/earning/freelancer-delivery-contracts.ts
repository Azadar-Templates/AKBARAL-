/** Trusted read-only file verifier. No live implementation is installed.
 * Must authenticate provider metadata AND download/hash actual stored bytes from
 * an authorized, allowlisted provider location. Never trusts file names, caller
 * JSON, a proposed upload or an arbitrary download URL as content verification.
 */
export interface FreelancerStoredFile {
  userId: string; projectId: string; fileId: string; fromUserId: string; toUserId: string;
  state: 'stored'; fileName: string; bytes: number; contentHash: string;
  createdAt: string; verifiedAt: string;
}
export interface FreelancerFileReader {
  readonly userId: string;
  verify(input: {projectId: string; fileId: string}, signal: AbortSignal): Promise<FreelancerStoredFile | null>;
}
