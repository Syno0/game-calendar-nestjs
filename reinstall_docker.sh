#!/bin/bash

sudo docker build -t game-calendar-nestjs .
sudo docker container stop game-calendar-nestjs
sudo docker container rm game-calendar-nestjs
sudo docker-compose up -d
sleep 1
sudo docker image prune -af