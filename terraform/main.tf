# ---------- lookups ----------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
  filter {
    name   = "availability-zone"
    values = [var.availability_zone]
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------- SSH key pair (private key stays on the developer machine) ----------
resource "tls_private_key" "deployer" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "deployer" {
  key_name   = "${var.project}-key"
  public_key = tls_private_key.deployer.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.deployer.private_key_openssh
  filename        = "${path.module}/../ansible/keys/${var.project}.pem"
  file_permission = "0600"
}

# ---------- firewall ----------
resource "aws_security_group" "web" {
  name        = "${var.project}-sg"
  description = "IncidentFlow store, Jenkins and SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP - Cartora store and IncidentFlow console"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Alternate HTTP port for networks that block port 80"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH for Ansible"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_ingress_cidrs
  }

  ingress {
    description = "Jenkins UI"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.jenkins_ingress_cidrs
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-sg" }
}

# ---------- server ----------
resource "aws_instance" "web" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.public.ids)[0]
  vpc_security_group_ids      = [aws_security_group.web.id]
  key_name                    = aws_key_pair.deployer.key_name
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  # Minimal bootstrap; all configuration is done by Ansible.
  user_data = <<-EOT
    #!/bin/bash
    hostnamectl set-hostname ${var.project}-web
    echo "bootstrapped by terraform at $(date -Is)" > /etc/incidentflow-bootstrap
  EOT

  tags = {
    Name = "${var.project}-web"
    Role = "jenkins-docker"
  }
}

# Static public IP so the URL and inventory survive Learner Lab restarts
resource "aws_eip" "web" {
  instance = aws_instance.web.id
  domain   = "vpc"
  tags     = { Name = "${var.project}-eip" }
}

# ---------- hand-off to Ansible ----------
resource "local_file" "inventory" {
  filename = "${path.module}/../ansible/inventory.ini"
  content  = <<-EOT
    [web]
    ${aws_eip.web.public_ip} ansible_user=ubuntu ansible_ssh_private_key_file=keys/${var.project}.pem
  EOT
}
