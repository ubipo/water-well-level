resource "aws_dynamodb_table" "data" {
  name           = "${var.dynamodb_table_prefix}_data"
  # hash_key and range_key can seemingly not be the same in terraform, so we
  # use a dummy hash_key
  hash_key       = "hash"
  range_key      = "timeS"
  billing_mode   = "PROVISIONED"
  read_capacity  = 1
  write_capacity = 1

  attribute {
    name = "hash"
    type = "N"
  }

  attribute {
    name = "timeS"
    type = "N"
  }
}

resource "aws_dynamodb_table" "config" {
  name           = "${var.dynamodb_table_prefix}_config"
  hash_key       = "hash"
  range_key      = "key"
  billing_mode   = "PROVISIONED"
  read_capacity  = 1
  write_capacity = 1

  attribute {
    name = "hash"
    type = "S"
  }

  attribute {
    name = "key"
    type = "S"
  }
}
