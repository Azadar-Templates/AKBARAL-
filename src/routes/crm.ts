import { Router } from 'express';
import {
  createCrmContact,
  listCrmContacts,
  createCrmPipeline,
  listCrmPipelines,
  createCrmDeal,
  listCrmDeals,
  createCampaign,
  listCampaigns,
  updateCampaignStatus,
  queueCampaignMessage,
  listCampaignMessages,
  createAutomation,
  listAutomations,
  recordAutomationRun,
  createAiEmployee,
  listAiEmployees,
  db,
} from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function assertOwnedProject(projectId: string, userId: string): void {
  const row = db.get<{ id: string }>('SELECT id FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId]);
  if (!row) {
    throw new HttpError(403, 'project does not belong to the current user', 'forbidden');
  }
}

function assertOwnedPipeline(pipelineId: string, userId: string): void {
  const row = db.get<{ id: string }>('SELECT id FROM crm_pipelines WHERE id = ? AND user_id = ?', [pipelineId, userId]);
  if (!row) {
    throw new HttpError(403, 'pipeline does not belong to the current user', 'forbidden');
  }
}

function assertOwnedContact(contactId: string, userId: string): void {
  const row = db.get<{ id: string }>('SELECT id FROM crm_contacts WHERE id = ? AND user_id = ?', [contactId, userId]);
  if (!row) {
    throw new HttpError(403, 'contact does not belong to the current user', 'forbidden');
  }
}

export function createCrmRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Contacts
  router.get('/contacts', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ contacts: listCrmContacts(req.auth!.userId) });
  });
  router.post('/contacts', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const projectId = optionalString(body, 'project_id') ?? null;
    if (projectId) assertOwnedProject(projectId, req.auth!.userId);
    const created = createCrmContact({
      userId: req.auth!.userId,
      projectId,
      firstName: optionalString(body, 'first_name') ?? null,
      lastName: optionalString(body, 'last_name') ?? null,
      email: optionalString(body, 'email') ?? null,
      phone: optionalString(body, 'phone') ?? null,
      company: optionalString(body, 'company') ?? null,
      title: optionalString(body, 'title') ?? null,
      source: optionalString(body, 'source') ?? null,
      tags: asStringArray(body.tags),
    });
    res.status(201).json({ contact: created });
  });

  // Pipelines & deals
  router.get('/pipelines', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ pipelines: listCrmPipelines(req.auth!.userId) });
  });
  router.post('/pipelines', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    res.status(201).json({ pipeline: createCrmPipeline({ userId: req.auth!.userId, name, stages: asStringArray(body.stages) }) });
  });
  router.get('/deals', (req: AuthenticatedRequest, res) => {
    const pipelineId = typeof req.query.pipeline_id === 'string' ? req.query.pipeline_id : undefined;
    res.status(200).json({ deals: listCrmDeals(req.auth!.userId, pipelineId) });
  });
  router.post('/deals', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const title = requireString(body, 'title', 'title');
    const pipelineId = optionalString(body, 'pipeline_id') ?? null;
    const contactId = optionalString(body, 'contact_id') ?? null;
    if (pipelineId) assertOwnedPipeline(pipelineId, req.auth!.userId);
    if (contactId) assertOwnedContact(contactId, req.auth!.userId);
    res.status(201).json({
      deal: createCrmDeal({
        userId: req.auth!.userId,
        title,
        pipelineId,
        contactId,
        stage: optionalString(body, 'stage'),
        amountCents: Number(body.amount_cents ?? 0),
        probability: Number(body.probability ?? 0),
      }),
    });
  });

  // Campaigns
  router.get('/campaigns', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ campaigns: listCampaigns(req.auth!.userId) });
  });
  router.post('/campaigns', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    res.status(201).json({
      campaign: createCampaign({
        userId: req.auth!.userId,
        name,
        type: optionalString(body, 'type') ?? 'email',
        audienceQuery: optionalString(body, 'audience_query') ?? null,
        scheduleAt: optionalString(body, 'schedule_at') ?? null,
      }),
    });
  });
  router.post('/campaigns/:id/send', (req: AuthenticatedRequest, res) => {
    const campaign = listCampaigns(req.auth!.userId).find((row) => String(row.id) === req.params.id);
    if (!campaign) {
      throw new HttpError(404, 'campaign not found', 'not_found');
    }
    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    if (!smtpConfigured) {
      updateCampaignStatus(req.params.id, 'paused');
      throw new HttpError(409, 'email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD', 'email_delivery_not_configured');
    }
    updateCampaignStatus(req.params.id, 'running');
    res.status(202).json({ status: 'queued_for_delivery', required: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] });
  });
  router.get('/campaigns/:id/messages', (req: AuthenticatedRequest, res) => {
    const campaign = listCampaigns(req.auth!.userId).find((row) => String(row.id) === req.params.id);
    if (!campaign) {
      throw new HttpError(404, 'campaign not found', 'not_found');
    }
    res.status(200).json({ messages: listCampaignMessages(req.params.id) });
  });
  router.post('/campaigns/:id/messages', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const campaign = listCampaigns(req.auth!.userId).find((row) => String(row.id) === req.params.id);
    if (!campaign) {
      throw new HttpError(404, 'campaign not found', 'not_found');
    }
    const recipient = requireString(body, 'recipient', 'recipient');
    const bodyText = requireString(body, 'body', 'body');
    res.status(201).json({
      message: queueCampaignMessage({
        campaignId: req.params.id,
        userId: req.auth!.userId,
        channel: optionalString(body, 'channel') ?? 'email',
        recipient,
        subject: optionalString(body, 'subject') ?? null,
        body: bodyText,
      }),
    });
  });

  // Automations
  router.get('/automations', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ automations: listAutomations(req.auth!.userId) });
  });
  router.post('/automations', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    const triggerKey = requireString(body, 'trigger_key', 'trigger_key');
    res.status(201).json({
      automation: createAutomation({
        userId: req.auth!.userId,
        name,
        triggerKey,
        condition: typeof body.condition === 'object' && body.condition !== null ? (body.condition as Record<string, unknown>) : null,
        steps: Array.isArray(body.steps) ? (body.steps as Array<Record<string, unknown>>) : [],
      }),
    });
  });
  router.post('/automations/:id/run', (req: AuthenticatedRequest, res) => {
    const automation = listAutomations(req.auth!.userId).find((row) => String(row.id) === req.params.id);
    if (!automation) {
      throw new HttpError(404, 'automation not found', 'not_found');
    }
    recordAutomationRun(req.params.id);
    res.status(200).json({ status: 'triggered', automation: { id: req.params.id } });
  });

  // AI employees
  router.get('/employees', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ employees: listAiEmployees(req.auth!.userId) });
  });
  router.post('/employees', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    const role = requireString(body, 'role', 'role');
    const assignedTo = optionalString(body, 'assigned_to') ?? null;
    if (assignedTo && assignedTo !== req.auth!.userId) {
      throw new HttpError(403, 'assigned_to must be the current user', 'forbidden');
    }
    res.status(201).json({
      employee: createAiEmployee({
        userId: req.auth!.userId,
        name,
        role,
        agentSlug: optionalString(body, 'agent_slug') ?? null,
        assignedTo,
      }),
    });
  });

  return router;
}
