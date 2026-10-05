#!/bin/bash

# Déploie le NestJS sans coupure. Le mécanisme vit dans le dépôt voisin
# (emergent-game-calendar-react-v2/rollout.sh), partagé avec le BFF et le front.
#
#   ./deploy.sh                 build + bascule
#   ./deploy.sh --no-build      bascule sur l'image déjà taguée
#   NEST_TAG=rollback-<date> ./deploy.sh --no-build    retour arrière
#
# Une migration Prisma se joue AVANT, et doit rester compatible avec le code
# en place : pendant la bascule, l'ancien et le nouveau tournent ensemble.

set -e

here="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$here" exec "$here/../emergent-game-calendar-react-v2/rollout.sh" game-calendar-nestjs "$@"
