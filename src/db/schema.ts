/**
 * Modelo de datos (PRD §9). Dos capas: identificable (`users`) y patrón (todo lo
 * demás referencia `pseudonym`). `bets` es append-only y es el activo.
 *
 * Principios no negociables (§19.2):
 * - `bets` append-only: una lectura emitida no se actualiza ni se borra.
 * - Separación identificable ↔ patrón vía `pseudonym`.
 * - `engine_version` en cada lectura.
 * - El LLM redacta, no decide el schema: la estructura la valida el sistema.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { WindowSpec } from '../domain/window-spec.js';

// ── Capa 1: identificable ────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  pseudonym: uuid('pseudonym').notNull().unique().defaultRandom(),
  whatsappPhone: text('whatsapp_phone').unique(),
  lifeStage: text('life_stage'),
  hasDiagnosis: boolean('has_diagnosis').default(false),
  diagnosisNotes: text('diagnosis_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Capa 2: patrón (referencia `pseudonym`) ──────────────────────────────────────

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pseudonym: uuid('pseudonym').notNull(),
    signalType: text('signal_type').notNull(),
    value: text('value'), // flexible: numérico o "bajo/medio/alto"
    unit: text('unit'),
    cycleDay: integer('cycle_day'),
    context: jsonb('context'),
    source: text('source').notNull(), // 'check_in' | 'conversation' | 'proactive'
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_signals_pseudonym').on(t.pseudonym)],
);

export const cycleEvents = pgTable('cycle_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  pseudonym: uuid('pseudonym').notNull(),
  eventType: text('event_type').notNull(), // 'period_start' | 'period_end'
  eventDate: date('event_date').notNull(),
  source: text('source').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const patterns = pgTable(
  'patterns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pseudonym: uuid('pseudonym').notNull(),
    variable: text('variable').notNull(),
    direction: text('direction').notNull(),
    windowSpec: jsonb('window_spec').$type<WindowSpec>().notNull(),
    belief: numeric('belief').notNull().default('0.5'),
    specificity: numeric('specificity').notNull().default('0.0'),
    status: text('status').notNull().default('candidate'), // candidate|active|promoted|discarded
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_patterns_pseudonym').on(t.pseudonym)],
);

// LA TABLA CENTRAL: bets (lecturas verificadas). APPEND-ONLY.
export const bets = pgTable(
  'bets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Nullable: en el borrado duro se "rompe el enlace" (pseudonym → NULL) para
    // conservar el agregado anónimo (PRD §9.6). Al insertar siempre va no-nulo.
    pseudonym: uuid('pseudonym'),
    patternId: uuid('pattern_id').references(() => patterns.id),
    readingText: text('reading_text').notNull(), // string humano (redacción del LLM)
    variable: text('variable').notNull(),
    direction: text('direction').notNull(),
    windowSpec: jsonb('window_spec').$type<WindowSpec>().notNull(),
    predictedDate: date('predicted_date').notNull(),
    result: text('result'), // 'yes'|'partial'|'no'|NULL (pendiente)
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    beliefPrior: numeric('belief_prior').notNull(),
    beliefPosterior: numeric('belief_posterior'),
    engineVersion: text('engine_version').notNull(),
    generator: text('generator').notNull(), // 'llm' | 'manual' | 'motor'
    // Estado de entrega del timbre de confirmación (no es contenido de lectura).
    reminderCount: integer('reminder_count').notNull().default(0),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_bets_pseudonym').on(t.pseudonym),
    // Índice parcial para el sweeper: confirmaciones pendientes.
    index('idx_bets_predicted_date')
      .on(t.predictedDate)
      .where(sql`${t.result} IS NULL`),
  ],
);

// Confirmaciones (inmutabilidad total: evento aparte, append-only).
// `corrected` soporta la corrección única de R3.6/AC14 (la primera gana; una
// corrección se registra como evento con flag, sin borrar la original).
export const betConfirmations = pgTable('bet_confirmations', {
  id: uuid('id').defaultRandom().primaryKey(),
  betId: uuid('bet_id').notNull().references(() => bets.id),
  result: text('result').notNull(), // 'yes'|'partial'|'no'
  source: text('source').notNull(), // 'whatsapp'|'web'|'push'
  corrected: boolean('corrected').notNull().default(false),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memoryEntries = pgTable('memory_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  pseudonym: uuid('pseudonym').notNull(),
  kind: text('kind').notNull(), // 'fact'|'preference'|'pattern_summary'|'intention'
  content: text('content').notNull(),
  sourceBetId: uuid('source_bet_id'),
  status: text('status').notNull().default('active'), // active|superseded|deleted
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Educación entregada (anclada a confirmación).
export const lessonsDelivered = pgTable('lessons_delivered', {
  id: uuid('id').defaultRandom().primaryKey(),
  pseudonym: uuid('pseudonym').notNull(),
  lessonKey: text('lesson_key').notNull(),
  betId: uuid('bet_id'), // regla: no hay microlección sin lectura verificada detrás
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Catálogo de contenido (estático, no es dato de usuaria).
export const content = pgTable('content', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonKey: text('lesson_key').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  topics: text('topics').array().notNull(),
  lifeStages: text('life_stages').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cola de mensajes proactivos (check-in / follow-up). La confirmación NO se guarda
// aquí: se deriva de `bets` (`predicted_date <= today AND result IS NULL`).
export const scheduledMessages = pgTable('scheduled_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  pseudonym: uuid('pseudonym').notNull(),
  kind: text('kind').notNull(), // 'check_in' | 'follow_up'
  payload: jsonb('payload').notNull(),
  sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'), // pending|sent|cancelled
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Ontología de patrones (knowledge engine). En el MVP arranca VACÍA (AC15): el LLM
// queda restringido por vocabulario controlado + falsabilidad, no por plausibilidad.
// Se construye a largo plazo con el motor híbrido.
export const patternTemplates = pgTable('pattern_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  ontologyVersion: text('ontology_version').notNull(), // 'onto-0.1'
  variable: text('variable').notNull(),
  direction: text('direction').notNull(),
  windowKind: text('window_kind').notNull(), // 'cycle_days' | 'weekdays'
  windowSpec: jsonb('window_spec').$type<WindowSpec>().notNull(),
  conditionVocab: text('condition_vocab').array(),
  prior: numeric('prior').notNull(), // plausibilidad desde evidencia (0..1)
  evidenceSource: text('evidence_source').notNull(),
  evidenceLevel: text('evidence_level').notNull(), // 'meta_analysis'|'cohort'|'expert'|'exploratory'
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
