CREATE TABLE beta (
  id int PRIMARY KEY,
  alpha_id int REFERENCES alpha(id)
);
