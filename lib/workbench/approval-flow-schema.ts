import {z} from 'zod';
import {memberLoginPattern} from './member-login.ts';

export const approvalFlowSchema = z.object({
  steps: z.array(z.string().regex(memberLoginPattern)).min(1).max(200),
  index: z.number().int().min(0),
  // Namesakes are displayed as a 40-character name plus a parenthesized login.
  names: z.array(z.string().trim().min(1).max(82)).max(200).optional()
}).strict().refine(flow => flow.index < flow.steps.length
  && new Set(flow.steps).size === flow.steps.length
  && (!flow.names || flow.names.length === flow.steps.length), '审批步骤不完整或顺序无效');
