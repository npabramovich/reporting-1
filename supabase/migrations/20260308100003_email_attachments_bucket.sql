-- Create the email-attachments storage bucket (private, admin-only access)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 26214400)  -- 25MB limit
ON CONFLICT (id) DO NOTHING;
