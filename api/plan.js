const ALLOWED_BACKENDS = new Set(['gcs', 's3', 'azurerm', 'remote']);
const PROTECTED_DESTROY_TYPES = new Set(['storage_bucket', 'sql_database', 'persistent_disk']);
const ALLOWED_ACTIONS = new Set(['create', 'update', 'delete']);
const ASSIGNED_WORKSPACE = 'prod-ciyucg';
const REQUIRED_LABELS = {
  owner: 'student-hxf6i',
  environment: 'production',
  cost_center: 'cc-cidv'
};

function isPlainObject(obj) {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isProviderPinned(versionStr) {
  if (typeof versionStr !== 'string') return false;
  const v = versionStr.trim();
  if (v.startsWith('~>') || v.startsWith('=')) {
    return true;
  }
  // Exact semantic version like "6.2.1" or "6.0"
  if (/^\d+(\.\d+)*$/.test(v)) {
    return true;
  }
  return false;
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = req.body;

  // Handle case where body might be a raw JSON string
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(200).json({ decision: "reject", reason: "INVALID_PLAN" });
    }
  }

  // 1. Strict Schema & Value Types Validation (INVALID_PLAN)
  if (!isPlainObject(body)) {
    return res.status(200).json({ decision: "reject", reason: "INVALID_PLAN" });
  }

  const { environment, state, providerVersion, destroyApproved, resource } = body;

  // Validate top-level keys
  if (
    typeof environment !== 'string' ||
    !isPlainObject(state) ||
    typeof providerVersion !== 'string' ||
    typeof destroyApproved !== 'boolean' ||
    !isPlainObject(resource)
  ) {
    return res.status(200).json({ decision: "reject", reason: "INVALID_PLAN" });
  }

  // Validate state object schema
  if (
    typeof state.backend !== 'string' ||
    typeof state.locked !== 'boolean'
  ) {
    return res.status(200).json({ decision: "reject", reason: "INVALID_PLAN" });
  }

  // Validate resource object schema
  if (
    typeof resource.address !== 'string' ||
    typeof resource.type !== 'string' ||
    typeof resource.action !== 'string' ||
    !ALLOWED_ACTIONS.has(resource.action) ||
    !isPlainObject(resource.labels) ||
    (resource.secret !== null && typeof resource.secret !== 'string') ||
    typeof resource.forceDestroy !== 'boolean'
  ) {
    return res.status(200).json({ decision: "reject", reason: "INVALID_PLAN" });
  }

  // 2. Environment Match (ENVIRONMENT_MISMATCH)
  if (environment !== ASSIGNED_WORKSPACE) {
    return res.status(200).json({ decision: "reject", reason: "ENVIRONMENT_MISMATCH" });
  }

  // 3. State Unsafe (STATE_UNSAFE)
  if (!ALLOWED_BACKENDS.has(state.backend) || state.locked !== true) {
    return res.status(200).json({ decision: "reject", reason: "STATE_UNSAFE" });
  }

  // 4. Provider Version Pinned (UNPINNED_PROVIDER)
  if (!isProviderPinned(providerVersion)) {
    return res.status(200).json({ decision: "reject", reason: "UNPINNED_PROVIDER" });
  }

  // 5. Assigned Labels (MISSING_LABELS)
  for (const [key, val] of Object.entries(REQUIRED_LABELS)) {
    if (resource.labels[key] !== val) {
      return res.status(200).json({ decision: "reject", reason: "MISSING_LABELS" });
    }
  }

  // 6. Plaintext Secret (PLAINTEXT_SECRET)
  if (resource.secret !== null) {
    if (!resource.secret.startsWith('secret://') || resource.secret === 'secret://') {
      return res.status(200).json({ decision: "reject", reason: "PLAINTEXT_SECRET" });
    }
  }

  // 7. Accidental Destruction (DELETE_NOT_APPROVED)
  if (resource.action === 'delete' && PROTECTED_DESTROY_TYPES.has(resource.type)) {
    if (!destroyApproved) {
      return res.status(200).json({ decision: "reject", reason: "DELETE_NOT_APPROVED" });
    }
  }

  // 8. Force Destroy (FORCE_DESTROY)
  if (resource.type === 'storage_bucket' && resource.forceDestroy === true) {
    return res.status(200).json({ decision: "reject", reason: "FORCE_DESTROY" });
  }

  // All checks passed
  return res.status(200).json({ decision: "approve", reason: "APPROVE" });
}
