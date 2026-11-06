#!/bin/bash

# The bucket the test runner uploads its results to, as the CDP Portal's S3 path does.
aws --endpoint-url=http://localhost:4566 s3 mb s3://test-results
