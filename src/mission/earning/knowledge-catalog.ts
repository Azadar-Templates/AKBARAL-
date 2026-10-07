import { missionDb, nowIso, type Row } from '../database';

export type KnowledgeCategory = 'web' | 'web3' | 'github' | 'infra';
export type KnowledgeSource = 'authoritative_reference' | 'owner_provided' | 'derived_from_own_rejection';

export interface KnowledgeDefinition {
  vulnClass: string;
  category: KnowledgeCategory;
  detectionPatterns: string[];
  codeSignals: string[];
  taintSources: string[];
  taintSinks: string[];
  validationChecklist: string[];
  safeReproductionTemplate: string[];
  commonFalsePositives: string[];
  falsePositiveSignals: string[];
  realWorldReferences: string[];
  severityGuidance: string[];
  cvssVectorGuidance: string[];
  confidenceFloor: number;
}

const OWASP = 'https://cheatsheetseries.owasp.org/cheatsheets/';
const PORTSWIGGER = 'https://portswigger.net/web-security/';
const SOLIDITY = 'https://docs.soliditylang.org/en/latest/security-considerations.html';
const OZ_SECURITY = 'https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard';
const EIP712 = 'https://eips.ethereum.org/EIPS/eip-712';
const EIP2612 = 'https://eips.ethereum.org/EIPS/eip-2612';
const EIP155 = 'https://eips.ethereum.org/EIPS/eip-155';
const EIP1271 = 'https://eips.ethereum.org/EIPS/eip-1271';
const GITHUB_ACTIONS = 'https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/secure-use-reference';
const GITHUB_SECRETS = 'https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning';
const GITHUB_DEPENDABOT = 'https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates';

function web(
  vulnClass: string,
  focus: string,
  falsePositives: string[],
  falsePositiveSignals: string[],
  references: string[],
  overrides: Partial<KnowledgeDefinition> = {},
): KnowledgeDefinition {
  return {
    vulnClass,
    category: 'web',
    detectionPatterns: [`Trace untrusted ${focus} from the request boundary to a security-sensitive operation.`, 'Compare the operation with its context-aware validation, encoding or authorization boundary.', 'Confirm that the behavior is reachable in the deployed code path rather than only in a test helper.'],
    codeSignals: [`request, message, header, cookie, URL, file or deserialized ${focus} enters application code`, 'validation is absent, performed after the sink, or relies on a client-controlled claim', `security-sensitive ${focus} sink is assembled through concatenation, implicit trust or a permissive default`],
    taintSources: ['HTTP path, query, body, header and cookie values', 'webhook, queue, uploaded-file and browser-controlled message fields'],
    taintSinks: [`framework or library operation that consumes ${focus}`, 'database, process, filesystem, network, browser DOM, template or authorization decision'],
    validationChecklist: ['Identify the exact source and sink with file/line evidence.', 'Show the boundary validation, encoding, authorization or isolation decision.', 'Reproduce only against an owner-authorized local/staging fixture with a harmless marker.', 'Check the realistic false-positive patterns before assigning severity.'],
    safeReproductionTemplate: ['Use a synthetic value such as KB_TEST_MARKER in an owner-authorized fixture.', 'Record request shape, response or local observation, and the exact code path; do not exfiltrate data or run destructive commands.', 'Reset the fixture and retain only the minimum evidence needed for review.'],
    commonFalsePositives: falsePositives,
    falsePositiveSignals,
    realWorldReferences: references,
    severityGuidance: ['Prioritize demonstrated confidentiality, integrity, availability or authorization impact over a pattern match.', 'Mark impact unverified when the authorized fixture cannot demonstrate it.'],
    cvssVectorGuidance: ['Use CVSS:3.1 base metrics only when the attack path, privileges, interaction and affected scope are evidenced.', 'Do not infer a score from a class name; record the vector and justification separately.'],
    confidenceFloor: 0.75,
    ...overrides,
  };
}

const WEB: KnowledgeDefinition[] = [
  web('sql_injection', 'SQL or query language input', ['Parameterized queries, prepared statements or a vetted query builder bind values safely.', 'A database error string without attacker-controlled query semantics is not proof of injection.'], ['parameterized', 'prepared statement', 'query builder', 'bind parameter'], [`${OWASP}SQL_Injection_Prevention_Cheat_Sheet.html`, `${PORTSWIGGER}sql-injection`], { codeSignals: ['string interpolation or concatenation reaches raw SQL, NoSQL, LDAP or ORM expression execution', 'database errors vary with a harmless quote/boolean marker and the application does not normalize input'], taintSinks: ['raw SQL execution, dynamic filter/order clause, stored procedure with dynamic SQL'] }),
  web('command_injection', 'shell or interpreter argument', ['A fixed command with an argument passed as an argv array is not shell injection.', 'A literal metacharacter in a log or rejected input is not execution evidence.'], ['execFile', 'spawn argv', 'allowlisted command', 'shell:false'], [`${OWASP}OS_Command_Injection_Defense_Cheat_Sheet.html`, `${PORTSWIGGER}os-command-injection`], { taintSinks: ['shell command, interpreter, template engine or job runner'], severityGuidance: ['Treat confirmed remote command execution as high impact; distinguish command selection from argument injection.'] }),
  web('xss', 'browser-rendered HTML, script or URL context', ['Context-aware output encoding or a trusted sanitizer can make an apparently dangerous sink safe.', 'A string containing markup in a non-rendered response, escaped text node or inert test fixture is not XSS.'], ['textContent', 'setAttribute allowlist', 'DOMPurify', 'HTML-encoded'], [`${OWASP}Cross_Site_Scripting_Prevention_Cheat_Sheet.html`, `${PORTSWIGGER}cross-site-scripting`], { detectionPatterns: ['Check stored, reflected and DOM flows separately.', 'Confirm the rendered context and whether a policy or sanitizer changes exploitability.', 'Use a harmless marker rather than a credential or destructive script.'], taintSinks: ['HTML parser, unsafe template interpolation, innerHTML/outerHTML, scriptable URL or DOM execution context'] }),
  web('csrf', 'state-changing browser request', ['A state-changing endpoint using a strong, checked anti-CSRF token is not vulnerable merely because it accepts cookies.', 'SameSite and origin checks may be compensating controls; verify their deployment and method coverage.'], ['csrf token', 'SameSite', 'Origin check', 'Referer validation'], [`${OWASP}Cross-Site_Request_ForgERY_Prevention_Cheat_Sheet.html`, `${PORTSWIGGER}csrf`], { taintSinks: ['state-changing endpoint authenticated by ambient browser credentials'] }),
  web('ssrf', 'server-initiated URL or network request', ['A strict scheme/host allowlist with DNS/IP revalidation can make a URL fetch safe.', 'A client-side fetch does not demonstrate server-side request forgery.'], ['allowlisted host', 'DNS rebind check', 'private IP rejection', 'redirect validation'], [`${OWASP}Server_Side_Request_ForgERY_Prevention_Cheat_Sheet.html`, `${PORTSWIGGER}ssrf`], { taintSinks: ['server HTTP client, URL previewer, webhook fetcher, cloud metadata or internal socket'] }),
  web('idor_bola', 'object identifier or record selector', ['A public object identifier is not IDOR when the authorization check is performed on the object owner/tenant.', 'A 404 for another tenant may be deliberate non-disclosure rather than evidence of access.'], ['object ID from path', 'tenant ID from body', 'missing ownership predicate', 'horizontal authorization'], [`${PORTSWIGGER}access-control`, `${OWASP}Authorization_Cheat_Sheet.html`], { vulnClass: 'idor_bola', taintSinks: ['record lookup, download, mutation or delete without an object-level authorization decision'] }),
  web('path_traversal', 'filesystem path or archive member', ['Path normalization followed by a root containment check can be safe.', 'A filename containing dots that never reaches a filesystem operation is not traversal.'], ['path.resolve', 'realpath containment', 'archive extraction', 'user-controlled filename'], [`${OWASP}Path_Traversal_Cheat_Sheet.html`, `${PORTSWIGGER}path-traversal`], { taintSinks: ['file open/read/write, archive extraction, template include or static-file resolver'] }),
  web('insecure_deserialization', 'serialized object or message', ['Parsing JSON into a plain data object without polymorphic construction is not automatically unsafe.', 'A signature failure or rejected payload is not deserialization execution.'], ['ObjectInputStream', 'pickle', 'gadget type', 'polymorphic binder'], [`${OWASP}Deserialization_Cheat_Sheet.html`, `${PORTSWIGGER}deserialization`], { taintSinks: ['object reconstruction, type resolver, gadget chain, expression or template evaluation'] }),
  web('broken_access_control', 'authorization decision', ['An endpoint exposed to a trusted service role may be intentionally privileged when the trust boundary is documented and authenticated.', 'A missing UI control is not an authorization bypass if the server enforces the policy.'], ['role from request', 'missing server-side policy', 'tenant boundary', 'privilege check'], [`${OWASP}Authorization_Cheat_Sheet.html`, `${PORTSWIGGER}access-control`], { taintSinks: ['privileged read/write/action without a server-side subject/resource/action decision'] }),
  web('business_logic', 'workflow invariant or transaction state', ['A rejected invalid sequence, feature flag, test-only route or owner-approved exception is not a logic flaw.', 'A price or limit visible to the client is not exploitable without a server-side invariant failure.'], ['state transition', 'replayable action', 'negative quantity', 'client-controlled price'], [`${PORTSWIGGER}logic-flaws`, `${OWASP}Business_Logic_Security_Cheat_Sheet.html`], { detectionPatterns: ['Model the intended invariant and the allowed state transitions.', 'Try only bounded, reversible requests in an authorized fixture.', 'Separate an availability annoyance from an integrity or financial outcome.'] }),
  web('file_upload', 'uploaded file metadata and content', ['Extension-only validation is weak, but a complete allowlist, content inspection, non-executable storage and download isolation can be sufficient.', 'A polyglot sample stored outside an executable path is not server-side code execution.'], ['multipart filename', 'MIME trust', 'webroot storage', 'image parser'], [`${OWASP}File_Upload_Cheat_Sheet.html`, `${PORTSWIGGER}file-upload`], { taintSinks: ['filesystem/webroot, image/document parser, archive extractor or content-disposition response'] }),
  web('race_condition', 'time-of-check/time-of-use or concurrent workflow', ['Two requests arriving close together without an invariant violation are not a race vulnerability.', 'A database transaction with a suitable lock/unique constraint can be the intended protection.'], ['check then update', 'nonce reuse', 'parallel requests', 'missing unique constraint'], [`${PORTSWIGGER}race-conditions`, `${OWASP}Business_Logic_Security_Cheat_Sheet.html`], { detectionPatterns: ['Name the shared invariant and the interleaving required to break it.', 'Use two bounded local requests and verify durable state, not only response timing.'] }),
  web('request_smuggling', 'HTTP message framing across intermediaries', ['A parser rejection, a proxy timeout or inconsistent header normalization without desynchronization is not proof.', 'A single server with no intermediary does not establish a smuggling path.'], ['Content-Length', 'Transfer-Encoding', 'HTTP/2 downgrade', 'proxy/backend parser'], [`${PORTSWIGGER}request-smuggling`, `${OWASP}HTTP_Request_Smuggling_Prevention_Cheat_Sheet.html`], { taintSinks: ['front-end/back-end message framing and connection reuse'] }),
  web('jwt_attacks', 'JWT header, claims and verification', ['A decoded JWT is not trusted merely because it is readable; verify algorithm, key, issuer, audience and expiry handling.', 'A test token rejected by signature or issuer validation is not an authentication bypass.'], ['alg none', 'algorithm confusion', 'kid lookup', 'issuer/audience'], [`${PORTSWIGGER}jwt`, `${OWASP}JSON_Web_Token_for_Java_Cheat_Sheet.html`], { taintSinks: ['token verification, key lookup, authorization claim and session creation'] }),
  web('oauth_redirect', 'OAuth redirect URI and authorization code', ['A redirect URI registered exactly and compared byte-for-byte is not an open redirect.', 'A documented native-app loopback or custom scheme must be evaluated under its explicit threat model.'], ['redirect_uri', 'state', 'PKCE', 'exact match'], [`${PORTSWIGGER}oauth`, `${OWASP}OAuth2_Cheat_Sheet.html`], { taintSinks: ['authorization redirect, code/token exchange and account-linking callback'] }),
  web('cors_misconfig', 'cross-origin response policy', ['Public, non-credentialed data can intentionally allow broad origins.', 'An echoed origin is not exploitable when credentials are forbidden and sensitive responses are not exposed.'], ['Access-Control-Allow-Origin echo', 'credentials true', 'null origin', 'preflight'], [`${PORTSWIGGER}cors`, `${OWASP}CORS_OriginHeaderScrutiny_Cheat_Sheet.html`], { taintSinks: ['browser cross-origin read of a credentialed or sensitive response'] }),
  web('session_fixation', 'session identifier lifecycle', ['A session cookie that remains stable across a non-authenticated page is not fixation unless authentication does not rotate it.', 'A server-side session identifier is not exposed merely because a cookie exists.'], ['session ID before login', 'regenerate after auth', 'cookie adoption', 'logout invalidation'], [`${OWASP}Session_Management_Cheat_Sheet.html`, `${PORTSWIGGER}authentication`], { taintSinks: ['login/session establishment, privilege change and logout'] }),
  web('sensitive_data_exposure', 'secret, personal or security-sensitive data', ['A public identifier, redacted value or intentionally public artifact is not sensitive exposure.', 'A secret-shaped test fixture must not be reported as a real credential.'], ['debug response', 'stack trace', 'source map', 'secret in repository'], [`${OWASP}Secrets_Management_Cheat_Sheet.html`, `${OWASP}Logging_Cheat_Sheet.html`], { taintSinks: ['HTTP response, logs, artifacts, client bundle, repository or analytics event'] }),
  web('missing_rate_limit', 'abuse-prone operation', ['A low-volume internal endpoint may be protected by upstream controls not visible in application code.', 'A rate limit is not required for every read; demonstrate a harmful or account-impacting operation.'], ['unbounded login', 'password reset', 'expensive query', 'bulk mutation'], [`${OWASP}REST_Security_Cheat_Sheet.html`, `${OWASP}Credential_Stuffing_Prevention_Cheat_Sheet.html`], { severityGuidance: ['Tie severity to demonstrated abuse capacity, account impact, cost or availability; do not equate absence of a local counter with exploitability.'] }),
  web('prototype_pollution', 'object prototype or merge operation', ['A safe own-property-only merge or null-prototype map is not prototype pollution.', 'A JSON key accepted but never merged into executable or authorization-sensitive objects is not impact.'], ['__proto__', 'constructor.prototype', 'deep merge', 'Object.assign'], [`${PORTSWIGGER}prototype-pollution`, `${OWASP}Prototype_Pollution_Prevention_Cheat_Sheet.html`], { taintSinks: ['recursive merge, property lookup, template/config option or command construction'] }),
];

function web3(
  vulnClass: string,
  focus: string,
  falsePositives: string[],
  falsePositiveSignals: string[],
  references: string[],
  overrides: Partial<KnowledgeDefinition> = {},
): KnowledgeDefinition {
  const base = web(vulnClass, focus, falsePositives, falsePositiveSignals, references, overrides);
  return { ...base, category: 'web3', ...overrides };
}

const WEB3: KnowledgeDefinition[] = [
  web3('reentrancy', 'external call and mutable state', ['A complete nonReentrant guard or checks-effects-interactions ordering can make a call pattern safe.', 'An external call to a trusted non-callback contract is not automatically reentrancy.'], ['nonReentrant', 'state update before call', 'trusted non-callback', 'guard modifier'], [SOLIDITY, OZ_SECURITY], { detectionPatterns: ['Check single-function, cross-function and cross-contract reentrancy separately.', 'Identify the attacker-controlled callback and the state invariant it can observe or mutate.'], taintSinks: ['call, delegatecall, token hook, ERC777/1155 receiver callback or arbitrary contract invocation'] }),
  web3('access_control', 'privileged Solidity operation', ['A modifier may intentionally permit a trusted admin contract, timelock or role manager.', 'A public view or immutable configuration setter is not a privilege escalation.'], ['onlyOwner', 'AccessControl', 'role admin', 'timelock'], [SOLIDITY, 'https://docs.openzeppelin.com/contracts/5.x/access-control'], { detectionPatterns: ['Map every privileged function to its authority, role administration and upgrade path.', 'Verify the authority cannot be obtained or changed by an unprivileged caller.'], taintSinks: ['mint, upgrade, pause, rescue, parameter setter or arbitrary call'] }),
  web3('integer_overflow_precision', 'arithmetic and fixed-point conversion', ['Checked arithmetic in the compiler version or SafeCast bounds can prevent overflow.', 'Rounding documented by the protocol and bounded by an invariant is not automatically a loss.'], ['unchecked arithmetic', 'uint cast', 'wad/ray scaling', 'rounding'], [SOLIDITY, 'https://docs.openzeppelin.com/contracts/5.x/api/utils#SafeCast'], { vulnClass: 'integer_overflow_precision', taintSinks: ['balance, share, price, fee, index or limit calculation'] }),
  web3('unchecked_call', 'low-level call result', ['An intentionally best-effort notification may ignore failure when no state or asset invariant depends on it.', 'A call result checked by a wrapper is not unchecked merely because the wrapper uses assembly.'], ['.call(', 'success', 'return data', 'send/value'], [SOLIDITY], { taintSinks: ['low-level call, send, token transfer or external action whose failure affects accounting'] }),
  web3('delegatecall', 'delegated code and storage context', ['A fixed, immutable library address or audited proxy implementation can be an intended delegatecall.', 'A delegatecall to a known library without attacker-controlled address is not arbitrary code execution.'], ['delegatecall', 'implementation slot', 'storage collision', 'user-supplied target'], [SOLIDITY], { taintSinks: ['delegatecall target selection and storage writes in caller context'] }),
  web3('selfdestruct', 'contract destruction or forced balance behavior', ['A protected, owner-only destruction path with a documented migration is not an unprivileged kill switch.', 'A contract receiving forced ETH is not itself a selfdestruct vulnerability.'], ['selfdestruct', 'destroy', 'metamorphic deployment', 'balance assumption'], [SOLIDITY], { taintSinks: ['selfdestruct or logic relying on code/balance permanence'] }),
  web3('proxy_upgrade_risk', 'proxy implementation upgrade', ['A timelocked, role-protected upgrade with initialized implementation and storage compatibility can be safe.', 'A proxy pattern alone is not a vulnerability.'], ['UUPS', 'TransparentUpgradeableProxy', 'implementation slot', 'initializer'], ['https://docs.openzeppelin.com/contracts/5.x/api/proxy'], { detectionPatterns: ['Check upgrade authority, initialization, storage layout and rollback/monitoring assumptions.', 'Trace whether an untrusted actor can select or influence implementation code.'] }),
  web3('signature_replay_permit', 'signed authorization or permit', ['A nonce, domain separator, deadline and chain binding can prevent replay.', 'A signature reused in a deliberate multi-use authorization is not replay.'], ['nonce', 'deadline', 'domain separator', 'permit'], [EIP712, EIP2612, EIP155], { taintSinks: ['signature verification, permit allowance, meta-transaction or relayer execution'] }),
  web3('ecrecover_malleability', 'secp256k1 signature recovery', ['OpenZeppelin ECDSA checks lower-S and valid recovery; a wrapper that delegates those checks is not malleable.', 'A signature rejected for zero address is not a bypass.'], ['ecrecover', 's value', 'v value', 'zero address'], [SOLIDITY, EIP712, EIP1271], { taintSinks: ['ecrecover result used as signer without canonicality and failure checks'] }),
  web3('flash_loan', 'same-transaction borrowed liquidity', ['A flash-loan-capable operation can be safe when all price, collateral and accounting invariants hold.', 'Large balance in a test fixture is not proof of a flash-loan attack.'], ['flashLoan', 'callback', 'same-block balance', 'temporary liquidity'], [SOLIDITY], { detectionPatterns: ['Show the borrowed asset, callback, invariant violation and repayment path in one safe local transaction.'], taintSinks: ['oracle-dependent pricing, collateral, governance vote or reserve accounting'] }),
  web3('oracle_price_manipulation', 'external price or exchange-rate feed', ['A TWAP with a sufficient safety window, liquidity bounds and staleness checks can resist a spot move.', 'A configurable oracle is not unsafe if its authority and update policy are protected.'], ['spot price', 'TWAP', 'stale answer', 'decimals'], ['https://docs.openzeppelin.com/contracts/5.x/api/interfaces#AggregatorV3Interface'], { detectionPatterns: ['Identify source, update cadence, decimals, staleness, deviation and fallback behavior.', 'Use a bounded local price perturbation; never manipulate a live market.'], falsePositiveSignals: ['twap', 'time weighted', 'safety window', 'staleness check'], taintSinks: ['liquidation, mint, collateral, swap, fee or settlement calculation'] }),
  web3('mev', 'transaction ordering and public mempool state', ['A user-visible slippage bound, commit-reveal or private order flow can be an intentional mitigation.', 'A profitable-looking order without a demonstrated ordering advantage is not an MEV finding.'], ['deadline', 'slippage', 'commit reveal', 'private mempool'], [SOLIDITY], { detectionPatterns: ['State the ordering assumption and affected transaction; demonstrate only with a local fork or simulation.'] }),
  web3('gas_griefing_dos', 'unbounded gas or iteration behavior', ['A bounded loop over storage or a caller-paid computation is not denial of service without a reachable limit.', 'An expensive function intended for an owner-controlled batch is not public griefing.'], ['unbounded loop', 'gas stipend', 'refund', 'storage iteration'], [SOLIDITY], { taintSinks: ['unbounded iteration, callback, fallback or state transition that can become uncallable'] }),
  web3('front_running', 'public transaction intent', ['A deadline and slippage/commitment check can make transaction ordering harmless.', 'A transaction visible in a local test mempool is not a loss without an affected invariant.'], ['minOut', 'deadline', 'commit reveal', 'nonce ordering'], [SOLIDITY], { detectionPatterns: ['Describe the precondition, front-run action, victim transaction and measurable loss in a simulation.'] }),
  web3('incorrect_fallback', 'fallback/receive dispatch', ['A fallback intentionally rejects unknown selectors or accepts ETH for a documented reason.', 'A proxy fallback that delegates to a fixed implementation is not incorrect by shape alone.'], ['fallback()', 'receive()', 'selector', 'msg.data'], [SOLIDITY], { taintSinks: ['fallback dispatch, ETH acceptance, proxy forwarding or selector parsing'] }),
  web3('weak_access_control', 'role hierarchy or authority transition', ['A trusted admin contract, timelock or governance executor may be the intended caller.', 'A public function that only changes caller-local state is not weak access control.'], ['tx.origin', 'msg.sender', 'role admin', 'owner transfer'], [SOLIDITY, 'https://docs.openzeppelin.com/contracts/5.x/access-control'], { vulnClass: 'weak_access_control', falsePositiveSignals: ['trusted admin', 'timelock', 'governance executor', 'onlyowner'] }),
  web3('uninitialized_storage', 'proxy or implementation initialization', ['A constructor initializes a non-proxy deployment, or an initializer is already locked.', 'A public initializer that cannot affect reachable state is not exploitable.'], ['initializer', 'initialized', 'disableInitializers', 'storage slot'], ['https://docs.openzeppelin.com/contracts/5.x/api/proxy'], { taintSinks: ['initializer, reinitializer or implementation storage used for authority'] }),
  web3('tx_origin_auth_bypass', 'tx.origin authorization', ['tx.origin used for analytics or anti-phishing messaging is not authorization.', 'A contract that explicitly rejects contract callers for a documented compatibility boundary needs separate review.'], ['tx.origin ==', 'origin check', 'phishing intermediary'], [SOLIDITY], { taintSinks: ['privileged state change guarded by tx.origin instead of msg.sender'] }),
  web3('event_emission_error', 'event/log consistency', ['Events are not the source of truth when the documented consumer reads storage.', 'An omitted informational event is not a security issue without an affected indexer, accounting or monitoring invariant.'], ['missing emit', 'wrong indexed field', 'event after revert', 'event/data mismatch'], [SOLIDITY], { taintSinks: ['event used as authorization, accounting, bridge or monitoring input'] }),
  web3('upgradeability_risk', 'upgrade lifecycle and implementation governance', ['A deliberately immutable contract has no upgrade risk.', 'A documented, owner-approved upgrade with storage and initializer checks is not automatically unsafe.'], ['upgradeTo', 'proxy admin', 'timelock', 'storage layout'], ['https://docs.openzeppelin.com/contracts/5.x/api/proxy', SOLIDITY], { vulnClass: 'upgradeability_risk' }),
];

const GITHUB: KnowledgeDefinition[] = [
  web('github_actions_injection', 'untrusted workflow expression or shell input', ['A workflow that quotes/isolates untrusted values and uses least-privilege permissions is not command injection.', 'A value rendered in a log without execution is not shell injection.'], ['pull_request_target', 'run:', '${{ github.event', 'script injection'], [GITHUB_ACTIONS], { category: 'github', taintSources: ['issue title/body, PR title/body, branch name, commit message, labels and workflow event payload'], taintSinks: ['shell command, action input, checkout ref or privileged workflow step'] }),
  web('dependency_confusion', 'package name and dependency resolution', ['A private package name with an explicit private registry and lockfile is not dependency confusion.', 'A stale dependency without a namespace collision is a maintenance issue, not this class.'], ['unscoped package', 'registry URL', 'lockfile', 'install script'], [GITHUB_DEPENDABOT], { category: 'github', taintSinks: ['package resolver, install lifecycle script or build pipeline'] }),
  web('secret_exposure', 'repository, workflow or artifact secret', ['A revoked synthetic fixture or redacted placeholder is not a live secret.', 'A public configuration value intended for client use is not a secret.'], ['secret scanning', '.env', 'workflow log', 'artifact'], [GITHUB_SECRETS], { category: 'github', taintSinks: ['repository history, issue/PR, workflow log, release artifact or client bundle'] }),
  web('unsafe_workflow_permissions', 'GitHub token permission and event trust', ['Read-only permissions and an unprivileged event do not create write authority.', 'A documented owner-approved bot with narrow repository permissions is not unsafe by name alone.'], ['permissions: write', 'pull_request_target', 'GITHUB_TOKEN', 'fork'], [GITHUB_ACTIONS], { category: 'github', taintSinks: ['repository write, release, deployment or secret access action'] }),
];

export const KNOWLEDGE_DEFINITIONS: KnowledgeDefinition[] = [...WEB, ...WEB3, ...GITHUB];

const ALLOWED_REFERENCE = /^https:\/\/(cheatsheetseries\.owasp\.org|portswigger\.net|docs\.soliditylang\.org|docs\.openzeppelin\.com|eips\.ethereum\.org|docs\.github\.com)\//;

export function validateKnowledgeReference(reference: string): boolean {
  return reference === '' || ALLOWED_REFERENCE.test(reference);
}

export function knowledgeDefinitions(): KnowledgeDefinition[] { return KNOWLEDGE_DEFINITIONS.map((definition) => ({ ...definition, realWorldReferences: [...definition.realWorldReferences] })); }

function json(value: unknown): string { return JSON.stringify(value); }

export function seedVulnerabilityKnowledge(): number {
  const now = nowIso();
  let inserted = 0;
  for (const definition of KNOWLEDGE_DEFINITIONS) {
    if (definition.realWorldReferences.some((reference) => !validateKnowledgeReference(reference))) throw new Error(`knowledge reference is not allow-listed for ${definition.vulnClass}`);
    const id = `vk-${definition.vulnClass}`;
    const existing = missionDb.get<Row>('SELECT id FROM vuln_knowledge WHERE vuln_class=?', [definition.vulnClass]);
    if (!existing) {
      missionDb.run(`INSERT INTO vuln_knowledge (id,vuln_class,category,detection_patterns_json,code_signals_json,taint_sources_json,taint_sinks_json,validation_checklist_json,safe_reproduction_template_json,common_false_positives_json,false_positive_signals_json,real_world_references_json,severity_guidance_json,cvss_vector_guidance_json,confidence_floor,source_type,source_ref,reference_status,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, definition.vulnClass, definition.category, json(definition.detectionPatterns), json(definition.codeSignals), json(definition.taintSources), json(definition.taintSinks), json(definition.validationChecklist), json(definition.safeReproductionTemplate), json(definition.commonFalsePositives), json(definition.falsePositiveSignals), json(definition.realWorldReferences), json(definition.severityGuidance), json(definition.cvssVectorGuidance), definition.confidenceFloor, 'authoritative_reference', definition.realWorldReferences[0] ?? '', definition.realWorldReferences.length ? 'verified' : 'unverified', 1, now, now]);
      inserted += 1;
    }
  }
  return inserted;
}

export function seedPlatformPlaybooks(): number {
  const platforms = missionDb.all<Row>('SELECT platform_key FROM platform_adapters ORDER BY platform_key');
  let inserted = 0;
  for (const platform of platforms) {
    const key = String(platform.platform_key);
    const existing = missionDb.get<Row>('SELECT platform_key FROM platform_playbooks WHERE platform_key=?', [key]);
    if (existing) continue;
    missionDb.run(`INSERT INTO platform_playbooks (platform_key,submission_workflow_steps_json,required_fields_json,severity_scale_json,asset_evidence_requirements_json,poc_requirements_json,format_limits_json,disclosure_rules_json,common_rejection_reasons_json,review_timeline_expectation,do_not_do_json,source_type,source_ref,status,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [key, json(['Owner must confirm the current program rules and scope.', 'Owner must verify the report fields, evidence and safe reproduction against the current program.', 'Owner approval is required before any submission; this build has no submission capability.']), '[]', json({ status: 'unverified' }), json(['Owner-confirmed asset and scope evidence']), json(['Owner-confirmed safe, non-destructive reproduction']), json({ status: 'unverified' }), json(['Follow the owner-confirmed disclosure and coordinated disclosure terms.']), json(['missing owner-confirmed required field', 'weak or unverifiable evidence', 'duplicate or out-of-scope report']), 'unverified', json(['Do not guess current fields, severity labels, word limits or review timelines.', 'Do not log in, submit, or contact a platform from this adapter.']), 'unverified', '', 'needs_owner_confirmation', nowIso()]);
    inserted += 1;
  }
  return inserted;
}

export interface AgentPlaybookSeed {
  role: string;
  steps: string[];
  inputs: string[];
  tools: string[];
  stops: string[];
  handoffTo: string | null;
  success: string[];
  fail: string[];
  vulnClasses: string[];
  sourceType?: string;
}

const CONTROL_PLAYBOOKS: AgentPlaybookSeed[] = [
  { role: 'code_analyst', steps: ['Confirm program, target and authorized source.', 'Consult relevant knowledge and record versions.', 'Map entry points, trust boundaries, sources and sinks.', 'Return locations and uncertainty without asserting exploitability.'], inputs: ['source', 'files'], tools: ['repo_read', 'pattern_match', 'knowledge_retrieval'], stops: ['scope is absent', 'source is unavailable', 'evidence cannot be localized'], handoffTo: 'security_auditor', success: ['code map has file/line evidence', 'knowledge trace is present'], fail: ['out-of-scope target', 'fabricated source or reference'], vulnClasses: [...WEB.map((item) => item.vulnClass), ...WEB3.map((item) => item.vulnClass)], sourceType: 'system_default' },
  { role: 'security_auditor', steps: ['Consult the pinned knowledge before analysis.', 'Test patterns against local authorized source.', 'Compare each candidate with false-positive patterns.', 'Return candidates with evidence and confidence, not findings by assertion.'], inputs: ['source', 'target'], tools: ['pattern_match', 'static_analysis', 'knowledge_retrieval'], stops: ['no authorized source', 'only a pattern with no sink or impact'], handoffTo: 'exploit_validator', success: ['candidate has source, sink, class and FP review'], fail: ['missing evidence', 'scope failure', 'invented reference'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'exploit_validator', steps: ['Confirm the target remains allowlisted.', 'Consult the safe reproduction template.', 'Run only a bounded local/staging check.', 'Record observed result and cleanup.'], inputs: ['observed', 'expected', 'harness'], tools: ['local_harness', 'knowledge_retrieval'], stops: ['destructive action required', 'live target or secret required'], handoffTo: 'test_engineer', success: ['reproduction is safe and repeatable'], fail: ['unverified impact', 'unsafe reproduction'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'test_engineer', steps: ['Pin the knowledge version and candidate invariant.', 'Write a bounded regression test plan.', 'Run local tests only.', 'Report failures and coverage gaps.'], inputs: ['source', 'finding'], tools: ['test_generator', 'local_harness', 'knowledge_retrieval'], stops: ['test needs a live or unauthorized target'], handoffTo: 'code_reviewer', success: ['test asserts the security invariant'], fail: ['test is destructive or non-reproducible'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'research_agent', steps: ['Use only owner-supplied or seeded authoritative references.', 'Verify target technology and version.', 'Record gaps rather than filling them with model text.'], inputs: ['references', 'technology'], tools: ['reference_reader', 'knowledge_retrieval'], stops: ['reference cannot be verified'], handoffTo: 'bug_bounty_rules', success: ['references have provenance'], fail: ['invented advisory or CVE'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'bug_bounty_rules', steps: ['Consult program and platform playbook.', 'Check scope, required evidence and severity rules.', 'Mark unverified platform requirements for owner confirmation.'], inputs: ['program', 'finding'], tools: ['scope_reader', 'rules_reader', 'knowledge_retrieval'], stops: ['program terms are missing or stale'], handoffTo: 'report_writer', success: ['each rule has a source or unverified flag'], fail: ['guessed field or limit'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'patch_developer', steps: ['Consult the pinned class checklist.', 'Prepare a private minimal patch.', 'Add a regression test.', 'Do not push or submit.'], inputs: ['source', 'finding', 'patch'], tools: ['repo_read', 'patch_writer', 'test_generator', 'knowledge_retrieval'], stops: ['patch changes unrelated behavior', 'owner approval is absent'], handoffTo: 'code_reviewer', success: ['draft diff and test are reviewable'], fail: ['external write or fabricated evidence'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'code_reviewer', steps: ['Consult the same pinned guidance and review FP notes.', 'Review diff, tests and invariant.', 'Report regressions and residual uncertainty.'], inputs: ['source', 'diff', 'tests'], tools: ['diff_reader', 'test_reader', 'knowledge_retrieval'], stops: ['diff or source is missing'], handoffTo: 'quality_gate', success: ['independent review is recorded'], fail: ['approval inferred from a clean diff'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'report_writer', steps: ['Consult platform and vulnerability playbooks.', 'Require asset, class, CVSS, reproduction, evidence and remediation.', 'Write only evidenced claims and attach the trace.'], inputs: ['finding', 'rules'], tools: ['report_template', 'knowledge_retrieval'], stops: ['required report field is missing'], handoffTo: 'quality_gate', success: ['report is complete and traceable'], fail: ['estimated impact or guessed requirement'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'browser_monitor', steps: ['Read owner-authorized observations only.', 'Consult platform playbook status.', 'Flag changes for owner review without login or interaction.'], inputs: ['observations'], tools: ['platform_observation_reader', 'knowledge_retrieval'], stops: ['observation source is not authorized'], handoffTo: 'bug_bounty_rules', success: ['freshness and provenance are visible'], fail: ['scraping or account access'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'git_agent', steps: ['Review the pinned finding trace.', 'Prepare a local branch/commit plan only.', 'Return an owner approval checklist.'], inputs: ['repo', 'patch'], tools: ['git_plan', 'knowledge_retrieval'], stops: ['push or PR action is requested'], handoffTo: 'code_reviewer', success: ['plan is draft-only'], fail: ['external repository mutation'], vulnClasses: ['github_actions_injection', 'dependency_confusion', 'secret_exposure', 'unsafe_workflow_permissions'], sourceType: 'system_default' },
  { role: 'orchestrator', steps: ['Load the run trace and stage gates.', 'Require consultation before analysis output.', 'Stop on scope, quality or owner approval failure.'], inputs: ['finding', 'stages'], tools: ['pipeline_state_reader'], stops: ['a required gate is absent'], handoffTo: 'quality_gate', success: ['stage history is complete'], fail: ['implicit approval'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'memory_knowledge_base', steps: ['Store only owner-approved private evidence and outcomes.', 'Attach provenance and knowledge version.', 'Never promote an unapproved lesson into guidance.'], inputs: ['operation', 'entry'], tools: ['knowledge_base', 'knowledge_retrieval'], stops: ['source is public runtime scraping or model invention'], handoffTo: 'quality_gate', success: ['entry is provenance-complete'], fail: ['secret, invented reference or unapproved change'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
  { role: 'quality_gate', steps: ['Run scope and report completeness checks.', 'Run false-positive review against the pinned class.', 'Block duplicates, weak evidence and unapproved learning.', 'Require owner approval before submission.'], inputs: ['finding', 'program'], tools: ['scope_reader', 'dedup_reader', 'cvss_calculator', 'knowledge_retrieval'], stops: ['any required check fails'], handoffTo: null, success: ['decision and cited reasons are durable'], fail: ['finding is passed on a pattern alone'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' },
];

function playbookJson(seed: AgentPlaybookSeed): string[] { return seed.steps; }

function upsertAgentPlaybook(seed: AgentPlaybookSeed): boolean {
  const existing = missionDb.get<Row>('SELECT agent_role FROM agent_playbooks WHERE agent_role=?', [seed.role]);
  const at = nowIso();
  const values = [json(playbookJson(seed)), json(seed.inputs), json(seed.tools), json(seed.stops), seed.handoffTo, json(seed.success), json(seed.fail), '[]', json(seed.vulnClasses), seed.sourceType ?? 'system_default', '', at];
  if (existing) return false;
  missionDb.run(`INSERT INTO agent_playbooks (agent_role,ordered_steps_json,required_inputs_json,tool_sequence_json,stop_conditions_json,handoff_to,success_criteria_json,fail_conditions_json,learned_improvements_json,vuln_classes_json,source_type,source_ref,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [seed.role, ...values]);
  return true;
}

export function seedControlAgentPlaybooks(): number {
  return CONTROL_PLAYBOOKS.reduce((count, seed) => count + (upsertAgentPlaybook(seed) ? 1 : 0), 0);
}

/** Create a playbook only for persisted registry roles; this never creates an agent. */
export function syncPersistedAgentPlaybooks(): number {
  let created = 0;
  const rows = missionDb.all<Row>(`SELECT slug,role_key,capabilities FROM mission_agents WHERE status='active' ORDER BY slug`);
  for (const row of rows) {
    const role = String(row.slug);
    if (!role || CONTROL_PLAYBOOKS.some((seed) => seed.role === role)) continue;
    const capabilities = (() => { try { const parsed = JSON.parse(String(row.capabilities ?? '[]')); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 50) : []; } catch { return []; } })();
    created += upsertAgentPlaybook({ role, steps: ['Confirm the owner-configured scope and inputs.', 'Consult the relevant seeded knowledge and record versions.', 'Perform only the bounded role task on local/authorized evidence.', 'Hand off uncertainty and evidence; never submit or approve.'], inputs: capabilities.length ? capabilities : ['owner-authorized input'], tools: ['knowledge_retrieval'], stops: ['scope or evidence is missing', 'external action would be required'], handoffTo: null, success: ['role output contains evidence and knowledge trace'], fail: ['fabricated finding, reference or action'], vulnClasses: KNOWLEDGE_DEFINITIONS.map((item) => item.vulnClass), sourceType: 'system_default' }) ? 1 : 0;
  }
  return created;
}

export function seedKnowledgeBase(): { vulnKnowledge: number; platformPlaybooks: number; controlPlaybooks: number; registryPlaybooks: number } {
  return { vulnKnowledge: seedVulnerabilityKnowledge(), platformPlaybooks: seedPlatformPlaybooks(), controlPlaybooks: seedControlAgentPlaybooks(), registryPlaybooks: syncPersistedAgentPlaybooks() };
}

export function parseKnowledgeRow(row: Row): Record<string, unknown> {
  const array = (key: string): unknown[] => { try { const value = JSON.parse(String(row[key] ?? '[]')); return Array.isArray(value) ? value : []; } catch { return []; } };
  return { id: String(row.id), vulnClass: String(row.vuln_class), category: String(row.category), detectionPatterns: array('detection_patterns_json'), codeSignals: array('code_signals_json'), taintSources: array('taint_sources_json'), taintSinks: array('taint_sinks_json'), validationChecklist: array('validation_checklist_json'), safeReproductionTemplate: array('safe_reproduction_template_json'), commonFalsePositives: array('common_false_positives_json'), falsePositiveSignals: array('false_positive_signals_json'), realWorldReferences: array('real_world_references_json'), severityGuidance: array('severity_guidance_json'), cvssVectorGuidance: array('cvss_vector_guidance_json'), confidenceFloor: Number(row.confidence_floor), sourceType: String(row.source_type), sourceRef: String(row.source_ref), referenceStatus: String(row.reference_status), version: Number(row.version), updatedAt: String(row.updated_at) };
}

export function controlPlaybookSeeds(): AgentPlaybookSeed[] { return CONTROL_PLAYBOOKS.map((seed) => ({ ...seed, steps: [...seed.steps], inputs: [...seed.inputs], tools: [...seed.tools], stops: [...seed.stops], success: [...seed.success], fail: [...seed.fail], vulnClasses: [...seed.vulnClasses] })); }
