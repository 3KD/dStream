#!/bin/bash
echo "=== Docker PS ===" > debug_out.txt
docker ps -a >> debug_out.txt 2>&1
echo "=== Docker Logs ===" >> debug_out.txt
docker logs dStream_ingest >> debug_out.txt 2>&1
echo "=== Curl Test ===" >> debug_out.txt
curl -v http://localhost:9990/v3/paths/list >> debug_out.txt 2>&1
echo "=== Done ===" >> debug_out.txt
