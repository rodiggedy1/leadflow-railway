-- Drops the sanitizer helper tables (they hold the original->fake maps). Run after verify.sql passes, before export.
DROP TABLE IF EXISTS __column_map;
DROP TABLE IF EXISTS __name_first;
DROP TABLE IF EXISTS __name_last;
DROP TABLE IF EXISTS __streets;
DROP TABLE IF EXISTS __team_words;
DROP TABLE IF EXISTS __synthetic_conversations;
DROP TABLE IF EXISTS __src_phone;
DROP TABLE IF EXISTS __map_phone;
DROP TABLE IF EXISTS __src_email;
DROP TABLE IF EXISTS __map_email;
DROP TABLE IF EXISTS __src_name;
DROP TABLE IF EXISTS __map_name;
DROP TABLE IF EXISTS __src_team;
DROP TABLE IF EXISTS __map_team;
DROP TABLE IF EXISTS __staging_sanitize_marker;
