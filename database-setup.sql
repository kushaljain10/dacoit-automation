-- Database setup for production multi-user authentication storage
-- Use this if you need to support multiple users in production

-- PostgreSQL setup
CREATE TABLE IF NOT EXISTS user_auth (
    user_id VARCHAR(255) PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    account_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_auth_user_id ON user_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_user_auth_account_id ON user_auth(account_id);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_auth_updated_at 
    BEFORE UPDATE ON user_auth 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
