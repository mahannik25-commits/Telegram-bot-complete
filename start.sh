#!/bin/bash
set -e

echo "📁 ساخت پوشه دانلود..."
mkdir -p downloads

echo "📦 نصب کتابخونه‌ها..."
npm install

echo "✅ نصب کامل شد. اجرای ربات..."
npm start
