data "aws_iam_policy_document" "assume_role" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }

  # statement {
  #   actions = ["dynamodb:scan", "dynamodb:getItem", "dynamodb:putItem", "dynamodb:updateItem", "dynamodb:deleteItem"]

  #   resources = ["arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${aws_dynamodb_table.dynamodb_table.name}"]
  # }
}

resource "aws_iam_role" "iam_for_lambda" {
  name               = "lambda_waterLevelHttp"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.iam_for_lambda.id
}

data "aws_iam_policy_document" "dynamodb_policy" {
  statement {
    actions = ["dynamodb:scan", "dynamodb:getItem", "dynamodb:putItem", "dynamodb:updateItem", "dynamodb:deleteItem"]

    resources = [
      for table in [aws_dynamodb_table.data, aws_dynamodb_table.config] :
      "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${table.name}"
    ]
  }

  statement {
    actions = ["sns:Publish"]

    resources = [aws_sns_topic.sns.arn]
  }
}

resource "aws_iam_role_policy" "dynamodb_policy" {
  name   = "${aws_iam_role.iam_for_lambda.name}_dynamodb_policy"
  role   = aws_iam_role.iam_for_lambda.id
  policy = data.aws_iam_policy_document.dynamodb_policy.json
}

variable "lambda_zip_file_path" {
  type = string
  default = "../lambda-api/dist/lambda.zip"
}

resource "aws_lambda_function" "lambda" {
  filename      = var.lambda_zip_file_path
  function_name = "waterLevelHttp"
  role          = aws_iam_role.iam_for_lambda.arn
  handler       = "lambda.handler"

  source_code_hash = "${filebase64sha256(var.lambda_zip_file_path)}"

  runtime = "nodejs18.x"
  timeout = 5

  environment {
    variables = {
      DYNAMODB_DATA_TABLE_NAME = aws_dynamodb_table.data.name
      DYNAMODB_CONFIG_TABLE_NAME = aws_dynamodb_table.config.name
      SNS_TOPIC_ARN = aws_sns_topic.sns.arn
    }
  }
}

resource "aws_lambda_function_url" "lambda" {
  function_name      = aws_lambda_function.lambda.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = true
    allow_headers = ["content-type", "authorization"]
    allow_methods = ["*"]
    allow_origins = ["*"]
    max_age = 60 * 60 * 2
  }
}

output "lambda_url" {
  value = aws_lambda_function_url.lambda.function_url
}
