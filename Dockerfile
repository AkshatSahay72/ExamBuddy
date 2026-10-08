# Use official Python 3.11 slim image
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

# Set work directory
WORKDIR /app

# Install dependencies first for Docker layer caching
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create a non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Copy application source code
COPY . /app/

# Set file permissions for non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port (default 5000, customizable via PORT env var)
EXPOSE 8000

# Run with Gunicorn, supporting dynamic $PORT injection by container platforms
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120"]
