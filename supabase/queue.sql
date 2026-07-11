-- Run once in Supabase SQL Editor, or enable Queues in Integrations and create
-- a durable Basic Queue named excel_processing in the Dashboard.
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('excel_processing');
