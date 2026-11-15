# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN pip install --no-cache-dir "numpy>=2.5" "xarray>=2025" "zarr>=3" "s3fs>=2025"
COPY build_grids.py fetch-grids.sh /app/
ENTRYPOINT ["/app/fetch-grids.sh"]
